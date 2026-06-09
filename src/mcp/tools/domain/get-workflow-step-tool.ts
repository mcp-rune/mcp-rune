import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ToolResult } from '../tool-result.js'
import { BaseDomainTool } from './base-domain-tool.js'
import {
  findStepInfo,
  renderLoopGroup,
  renderNextStepHint,
  renderParallelGroup,
  renderStepDetail
} from './workflow-renderer.js'

interface WorkflowStep {
  order: number
  tool: string
  contextHint?: Record<string, unknown>
  [key: string]: unknown
}

interface WorkflowDefinition {
  name: string
  steps: WorkflowStep[]
  [key: string]: unknown
}

/**
 * Get details for a specific workflow step
 *
 * Returns full detail for one step (tool, args, tips, exclusion warnings).
 * For loop/parallel groups, returns all steps in the group together.
 * Stateless -- the LLM manages progression by requesting steps sequentially.
 */
export class GetWorkflowStepTool extends BaseDomainTool {
  override get name(): string {
    return 'get_workflow_step'
  }

  override get baseDescription(): string {
    return `Get detailed instructions for a specific workflow step. Returns the step's tool, arguments, tips, and guidance. For loop or parallel groups, returns all steps in the group together. Call this after suggest_workflow to advance through each step.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      workflow: z.string().describe('Workflow name (from suggest_workflow)'),
      step: z.number().describe('Step number to get details for')
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.requireDomainRegistry()
    const { workflow: workflowName, step: stepOrder } = args as {
      workflow: string
      step: number
    }

    const w = (await this.domainRegistry.getWorkflow(workflowName)) as unknown as
      | WorkflowDefinition
      | undefined
    if (!w) {
      const all = (await this.domainRegistry.getAllWorkflows()) as unknown as WorkflowDefinition[]
      const names = all.map((wf) => `\`${wf.name}\``).join(', ')
      return this.formatResponse(`Workflow "${workflowName}" not found. Available: ${names}`)
    }

    const info = findStepInfo(w as Parameters<typeof findStepInfo>[0], stepOrder)
    if (!info) {
      const available = w.steps.map((s) => s.order).join(', ')
      return this.formatResponse(
        `Step ${stepOrder} not found in workflow "${workflowName}". Available steps: ${available}`
      )
    }

    const appToolNames =
      ((this.serverContext as Record<string, unknown>)?.appToolNames as string[]) ?? []
    const parts: string[] = []

    if (info.groupType === 'loop') {
      parts.push(
        renderLoopGroup(info.group, w as Parameters<typeof renderLoopGroup>[1], { appToolNames })
      )
    } else if (info.groupType === 'parallel') {
      parts.push(renderParallelGroup(info.group, { appToolNames }))
      const lastOrder = info.group[info.group.length - 1]!.order
      parts.push(renderNextStepHint(w as Parameters<typeof renderNextStepHint>[0], lastOrder))
    } else {
      parts.push(renderStepDetail(info.step, { appToolNames }))
      parts.push(renderNextStepHint(w as Parameters<typeof renderNextStepHint>[0], info.step.order))
    }

    // Collect context hints from steps (for transient context protocol)
    const stepsToCheck = info.group || [info.step]
    const contextHints = stepsToCheck
      .filter((s) => (s as WorkflowStep).contextHint)
      .map((s) => ({
        step: s.order,
        tool: (s as WorkflowStep).tool,
        ...(s as WorkflowStep).contextHint
      }))
    const meta = contextHints.length > 0 ? { contextHints } : undefined

    return this.formatResponse(parts.join('\n'), { meta })
  }
}
