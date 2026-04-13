import { z } from 'zod'
import { BaseDomainTool } from './base-domain-tool.js'
import {
  renderStepDetail,
  renderLoopGroup,
  renderParallelGroup,
  renderNextStepHint,
  findStepInfo
} from './workflow-renderer.js'

/**
 * Get details for a specific workflow step
 *
 * Returns full detail for one step (tool, args, tips, exclusion warnings).
 * For loop/parallel groups, returns all steps in the group together.
 * Stateless — the LLM manages progression by requesting steps sequentially.
 */
export class GetWorkflowStepTool extends BaseDomainTool {
  get name() {
    return 'get_workflow_step'
  }

  get baseDescription() {
    return `Get detailed instructions for a specific workflow step. Returns the step's tool, arguments, tips, and guidance. For loop or parallel groups, returns all steps in the group together. Call this after suggest_workflow to advance through each step.`
  }

  get inputSchema() {
    return {
      workflow: z.string().describe('Workflow name (from suggest_workflow)'),
      step: z.number().describe('Step number to get details for')
    }
  }

  async execute(args) {
    this.requireDomainRegistry()
    const { workflow: workflowName, step: stepOrder } = args

    const w = this.domainRegistry.getWorkflow(workflowName)
    if (!w) {
      const all = this.domainRegistry.workflows.getAllWorkflows()
      const names = all.map((w) => `\`${w.name}\``).join(', ')
      return this.formatResponse(`Workflow "${workflowName}" not found. Available: ${names}`)
    }

    const info = findStepInfo(w, stepOrder)
    if (!info) {
      const available = w.steps.map((s) => s.order).join(', ')
      return this.formatResponse(
        `Step ${stepOrder} not found in workflow "${workflowName}". Available steps: ${available}`
      )
    }

    const appToolNames = this.serverContext?.appToolNames || []
    const parts = []

    if (info.groupType === 'loop') {
      parts.push(renderLoopGroup(info.group, w, { appToolNames }))
    } else if (info.groupType === 'parallel') {
      parts.push(renderParallelGroup(info.group, { appToolNames }))
      const lastOrder = info.group[info.group.length - 1].order
      parts.push(renderNextStepHint(w, lastOrder))
    } else {
      parts.push(renderStepDetail(info.step, { appToolNames }))
      parts.push(renderNextStepHint(w, info.step.order))
    }

    // Collect context hints from steps (for transient context protocol)
    const stepsToCheck = info.group || [info.step]
    const contextHints = stepsToCheck
      .filter((s) => s.contextHint)
      .map((s) => ({ step: s.order, tool: s.tool, ...s.contextHint }))
    const meta = contextHints.length > 0 ? { contextHints } : undefined

    return this.formatResponse(parts.join('\n'), { meta })
  }
}
