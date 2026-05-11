/**
 * Workflow Renderer -- shared rendering functions for workflow tools
 *
 * Extracts step/workflow rendering from SuggestWorkflowTool so both
 * suggest_workflow and get_workflow_step can reuse the same logic.
 */

// ============================================================================
// Types
// ============================================================================

interface DecisionOption {
  label: string
  description: string
}

interface WorkflowStep {
  order: number
  title: string
  description: string
  tool?: string
  toolArgs?: Record<string, unknown>
  tips: string[]
  dependsOn?: number[]
  changeset?: {
    requiresPlan?: boolean
    mutating?: boolean
  }
  exhaustive?: boolean
  decision?: {
    question: string
    options: DecisionOption[]
  }
  optional?: boolean
  fallbackDescription?: string
  loopGroup?: string
  parallelGroup?: string
  contextHint?: Record<string, unknown>
  [key: string]: unknown
}

interface WorkflowDefinition {
  name: string
  title: string
  description: string
  tags: string[]
  models: string[]
  steps: WorkflowStep[]
  draftRequired?: boolean
  [key: string]: unknown
}

interface RenderOptions {
  headingLevel?: string
  appToolNames?: string[]
}

/**
 * Data-fetching tools that should never be substituted with app/view tools.
 * Used to determine which steps get exclusion warnings.
 */
const DATA_TOOLS = new Set(['list_models', 'find_records', 'search_records', 'get_filters_guide'])

// ---- Step Rendering --------------------------------------------------------

/** Render a single step with full detail (tool, args, tips, exclusion, pagination). */
export function renderStepDetail(
  step: WorkflowStep,
  { headingLevel = '###', appToolNames = [] }: RenderOptions = {}
): string {
  const lines: string[] = []

  lines.push(`${headingLevel} Step ${step.order}: ${step.title}`)
  lines.push(step.description)

  if (step.dependsOn && step.dependsOn.length > 0) {
    const deps = step.dependsOn.map((d) => `Step ${d}`).join(', ')
    lines.push(`\n**Depends on:** ${deps}`)
  }

  if (step.changeset?.requiresPlan) {
    lines.push(
      `\n> **REQUIRED:** Call \`preview_mutation_plan\` before executing mutations. Show the user a visual preview of all planned changes first.`
    )
  }

  if (step.changeset?.mutating) {
    lines.push(
      `\n**Mutating:** Include \`plan_id\` from the preview step in this tool call for batch tracking.`
    )
  }

  if (step.tool) {
    const argsStr = step.toolArgs ? JSON.stringify(step.toolArgs, null, 2) : ''
    lines.push(`\n**Tool:** \`${step.tool}\``)
    lines.push(renderToolGuidance(step, { appToolNames }))
    if (argsStr) {
      lines.push('```json')
      lines.push(argsStr)
      lines.push('```')
    }
  }

  if (step.exhaustive) {
    lines.push(renderPaginationGuidance(step))
  }

  if (step.decision) {
    lines.push(`\n**Decision:** ${step.decision.question}`)
    for (const opt of step.decision.options) {
      lines.push(`- **${opt.label}**: ${opt.description}`)
    }
  }

  if (step.optional) {
    lines.push(`\n> **Optional step** — skip if \`${step.tool}\` is not available.`)
    if (step.fallbackDescription) {
      lines.push(`> **Instead:** ${step.fallbackDescription}`)
    }
  }

  if (step.tips.length > 0) {
    lines.push('\n**Tips:**')
    for (const tip of step.tips) {
      lines.push(`- ${tip}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ---- Tool Guidance ---------------------------------------------------------

/**
 * Generate a dynamic tool exclusion warning based on the step's tool type.
 *
 * - Data tools: warn against app/view tool substitution (lists actual app tool names)
 * - Other tools: simpler "do not substitute" warning
 * - App tools or no tool: no warning
 */
export function renderToolGuidance(
  step: WorkflowStep,
  { appToolNames = [] }: RenderOptions = {}
): string {
  if (!step.tool) return ''

  // App/view tools don't need exclusion warnings
  if (appToolNames.includes(step.tool)) return ''

  if (DATA_TOOLS.has(step.tool)) {
    // Data tools: warn against specific app/view tools
    const exclusions = appToolNames
      .filter((name) => name !== step.tool)
      .map((name) => `\`${name}\``)
    const exclusionList = exclusions.length > 0 ? `${exclusions.join(', ')}, or any other` : 'any'
    return `> IMPORTANT: Call \`${step.tool}\` exactly as specified. Do NOT substitute with ${exclusionList} visual/interactive tool.`
  }

  // Non-data tools: simpler warning
  return `> IMPORTANT: Call \`${step.tool}\` exactly as specified. Do NOT substitute with any other tool.`
}

/** Generate pagination guidance for exhaustive steps. */
export function renderPaginationGuidance(step: WorkflowStep): string {
  const tool = step.tool || 'the tool'
  return (
    `\n> **Exhaustive fetch:** This step requires ALL matching records. ` +
    `Check \`pagination.total_pages\` in the \`${tool}\` response. ` +
    `If total_pages > 1, repeat with page: 2, 3, etc. until all pages are collected.`
  )
}

// ---- Step Groups -----------------------------------------------------------

/** Render a loop group (adjacent steps that iterate together per page). */
export function renderLoopGroup(
  steps: WorkflowStep[],
  workflow: WorkflowDefinition,
  { appToolNames = [] }: RenderOptions = {}
): string {
  const lines: string[] = []
  const orderRange = steps.map((s) => s.order).join('\u2013')
  const lastOrder = steps[steps.length - 1]!.order
  const nextStep = findNextStepOrder(workflow, lastOrder)

  lines.push(`## Steps ${orderRange} \u2014 loop (repeat for each page of results)`, '')
  lines.push(
    '> These steps form a loop. Execute all steps in the group, then check ' +
      '`pagination.total_pages` from the search response:'
  )
  lines.push('> - If more pages remain, repeat these steps with the next page number')
  if (nextStep) {
    lines.push(
      `> - When all pages are processed, you MUST call \`get_workflow_step({ workflow: "${workflow.name}", step: ${nextStep} })\` \u2014 do NOT proceed without it`
    )
  } else {
    lines.push('> - When all pages are processed, the workflow is complete')
  }
  lines.push('')

  for (const step of steps) {
    lines.push(renderStepDetail(step, { headingLevel: '###', appToolNames }))
  }

  return lines.join('\n')
}

/** Render a parallel group (adjacent steps that run concurrently). */
export function renderParallelGroup(
  steps: WorkflowStep[],
  { appToolNames = [] }: RenderOptions = {}
): string {
  const lines: string[] = []
  const orderRange = steps.map((s) => s.order).join('\u2013')

  lines.push(`## Steps ${orderRange} \u2014 parallel (call these tools simultaneously)`, '')
  lines.push(
    '> These steps are independent. Call all tools in the same turn for faster execution.',
    ''
  )

  for (const step of steps) {
    lines.push(renderStepDetail(step, { headingLevel: '###', appToolNames }))
  }

  return lines.join('\n')
}

// ---- Workflow-Level Rendering ----------------------------------------------

/** Render the workflow overview (title, description, metadata). */
export function renderWorkflowOverview(workflow: WorkflowDefinition): string {
  const lines = [`# ${workflow.title}`, '']
  lines.push(workflow.description, '')

  if (workflow.tags.length > 0) {
    lines.push(`**Tags:** ${workflow.tags.join(', ')}`)
  }
  if (workflow.models.length > 0) {
    lines.push(`**Models:** ${workflow.models.join(', ')}`)
  }
  if (workflow.draftRequired) {
    lines.push(
      `**Draft Required:** Yes \u2014 call \`preview_mutation_plan\` before executing mutations`
    )
  }
  lines.push('')

  return lines.join('\n')
}

/** Render a roadmap of all steps (titles + brief descriptions, no tool details). */
export function renderRoadmap(workflow: WorkflowDefinition): string {
  const lines = ['## Roadmap', '']

  for (const step of workflow.steps) {
    const suffix = step.loopGroup ? ' *(loop)*' : step.parallelGroup ? ' *(parallel)*' : ''
    lines.push(`${step.order}. ${step.title}${suffix}`)
  }
  lines.push('')

  return lines.join('\n')
}

/** Render a next-step hint telling the LLM what to call after completing a step. */
export function renderNextStepHint(workflow: WorkflowDefinition, currentStepOrder: number): string {
  const currentStep = workflow.steps.find((s) => s.order === currentStepOrder)

  // Draft-plan steps: tell the LLM to STOP and wait for user review
  if (currentStep?.changeset?.requiresPlan) {
    return (
      '---\n**STOP \u2014 WAIT FOR USER REVIEW.** A draft plan is displayed. ' +
      'Do NOT call the next step or any mutation tool until the user explicitly ' +
      'approves or asks you to proceed. If the user wants to modify entries, help them.'
    )
  }

  const nextOrder = findNextStepOrder(workflow, currentStepOrder)

  if (!nextOrder) {
    return '---\n**Workflow complete.** All steps have been executed.'
  }

  return `---\n**REQUIRED next action:** Call \`get_workflow_step({ workflow: "${workflow.name}", step: ${nextOrder} })\` \u2014 do NOT proceed without it.`
}

/** Render the workflow list (for discovery/search results). */
export function renderWorkflowList(workflows: WorkflowDefinition[], heading: string): string {
  const lines = [`# ${heading}`, '']
  for (const w of workflows) {
    const tags = w.tags.length > 0 ? ` [${w.tags.join(', ')}]` : ''
    lines.push(`- **${w.title}** (\`${w.name}\`)${tags}`)
    lines.push(`  ${w.description}`)
    lines.push('')
  }
  lines.push('Use `workflow: "<name>"` to get the full step-by-step guide.')
  return lines.join('\n')
}

// ---- Helpers ---------------------------------------------------------------

/** Collect a step group (loop or parallel) from adjacent steps with the same group key. */
export function collectStepGroup(
  steps: WorkflowStep[],
  startIndex: number,
  groupKey: 'loopGroup' | 'parallelGroup'
): { group: WorkflowStep[]; endIndex: number } {
  const groupValue = steps[startIndex]![groupKey]
  const group: WorkflowStep[] = []
  let i = startIndex

  while (i < steps.length && steps[i]![groupKey] === groupValue) {
    group.push(steps[i]!)
    i++
  }

  return { group, endIndex: i }
}

/** Find the next step order number after a given step, skipping over group members. */
export function findNextStepOrder(
  workflow: WorkflowDefinition,
  currentOrder: number
): number | null {
  const currentIndex = workflow.steps.findIndex((s) => s.order === currentOrder)
  if (currentIndex === -1) return null

  const currentStep = workflow.steps[currentIndex]!

  // If in a group (loop or parallel), find the end of the group
  if (currentStep.loopGroup || currentStep.parallelGroup) {
    const groupKey: 'loopGroup' | 'parallelGroup' = currentStep.loopGroup
      ? 'loopGroup'
      : 'parallelGroup'
    // Find the start of the group (currentIndex may be inside)
    let groupStart = currentIndex
    while (groupStart > 0 && workflow.steps[groupStart - 1]![groupKey] === currentStep[groupKey]) {
      groupStart--
    }
    const { endIndex } = collectStepGroup(workflow.steps, groupStart, groupKey)
    return endIndex < workflow.steps.length ? workflow.steps[endIndex]!.order : null
  }

  // Regular step: next is just the next index
  const nextIndex = currentIndex + 1
  return nextIndex < workflow.steps.length ? workflow.steps[nextIndex]!.order : null
}

interface StepInfo {
  step: WorkflowStep
  groupType: string | null
  group: WorkflowStep[]
}

/** Find the step group info for a given step order. */
export function findStepInfo(workflow: WorkflowDefinition, stepOrder: number): StepInfo | null {
  const stepIndex = workflow.steps.findIndex((s) => s.order === stepOrder)
  if (stepIndex === -1) return null

  const step = workflow.steps[stepIndex]!

  // Check for loop group
  if (step.loopGroup) {
    let groupStart = stepIndex
    while (groupStart > 0 && workflow.steps[groupStart - 1]!.loopGroup === step.loopGroup) {
      groupStart--
    }
    const { group } = collectStepGroup(workflow.steps, groupStart, 'loopGroup')
    return { step, groupType: 'loop', group }
  }

  // Check for parallel group
  if (step.parallelGroup) {
    let groupStart = stepIndex
    while (groupStart > 0 && workflow.steps[groupStart - 1]!.parallelGroup === step.parallelGroup) {
      groupStart--
    }
    const { group } = collectStepGroup(workflow.steps, groupStart, 'parallelGroup')
    return { step, groupType: 'parallel', group }
  }

  return { step, groupType: null, group: [step] }
}
