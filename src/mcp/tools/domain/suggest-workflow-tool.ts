import { z } from 'zod'
import { BaseDomainTool } from './base-domain-tool.js'
import type { ToolResult } from '../base-tool.js'
import type { ZodTypeAny } from 'zod'
import {
  renderWorkflowOverview,
  renderRoadmap,
  renderStepDetail,
  renderLoopGroup,
  renderParallelGroup,
  renderNextStepHint,
  renderWorkflowList,
  collectStepGroup
} from './workflow-renderer.js'

interface WorkflowStep {
  order: number
  title: string
  loopGroup?: string
  parallelGroup?: string
  [key: string]: unknown
}

interface WorkflowDefinition {
  name: string
  title: string
  description: string
  tags: string[]
  models: string[]
  steps: WorkflowStep[]
  [key: string]: unknown
}

interface WorkflowsRegistry {
  getAllWorkflows(): WorkflowDefinition[]
}

/**
 * Suggest a workflow for a given goal
 *
 * Returns a workflow roadmap (step titles) plus the first step in full detail.
 * The LLM executes one step at a time, calling get_workflow_step for each
 * subsequent step.
 */
export class SuggestWorkflowTool extends BaseDomainTool {
  override get name(): string {
    return 'suggest_workflow'
  }

  override get baseDescription(): string {
    return `Get a structured multi-step workflow for a goal. Returns a roadmap of all steps plus the first step in detail. Use get_workflow_step to advance through subsequent steps.

USE THIS TOOL WHEN:
- Troubleshooting "No rights" or "In conflict" status on schedule entries
- Setting up complex features like catch-up VOD or licensing deals
- Learning how entities interact (requirements system, deal -> rights flow)
- Orchestrating multi-step processes spanning multiple entities

Available workflows include troubleshooting guides, configuration walkthroughs, and learning paths.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      goal: z
        .string()
        .describe(
          'What you want to accomplish (e.g., "set up catch-up VOD", "demo rules", "create a licensing deal")'
        )
        .optional(),
      workflow: z
        .string()
        .describe('Exact workflow name if known (e.g., "catchup_vod_setup")')
        .optional(),
      tag: z.string().describe('Filter by tag (e.g., "demo", "onboarding")').optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.requireDomainRegistry()
    const { goal, workflow, tag } = args as {
      goal?: string
      workflow?: string
      tag?: string
    }

    const registry = this.domainRegistry as Record<string, unknown>

    // Exact workflow lookup
    if (workflow) {
      const w = (registry.getWorkflow as (name: string) => WorkflowDefinition | null)(workflow)
      if (!w) {
        const all = (registry.workflows as WorkflowsRegistry).getAllWorkflows()
        const names = all.map((wf) => `\`${wf.name}\``).join(', ')
        return this.formatResponse(`Workflow "${workflow}" not found. Available: ${names}`)
      }
      return this.formatResponse(this._formatWorkflow(w))
    }

    // Tag filtering
    if (tag) {
      const results = (registry.getWorkflowsByTag as (t: string) => WorkflowDefinition[])(tag)
      if (results.length === 0) {
        return this.formatResponse(`No workflows found with tag "${tag}".`)
      }
      if (results.length === 1) {
        return this.formatResponse(this._formatWorkflow(results[0]!))
      }
      return this.formatResponse(
        renderWorkflowList(
          results as Parameters<typeof renderWorkflowList>[0],
          `Workflows tagged "${tag}"`
        )
      )
    }

    // Goal search
    if (goal) {
      const results = (await (registry.suggestWorkflow as (g: string) => Promise<WorkflowDefinition[]>)(goal))
      if (results.length === 0) {
        return this.formatResponse(this._formatNoResults(goal))
      }
      if (results.length === 1) {
        return this.formatResponse(this._formatWorkflow(results[0]!))
      }
      return this.formatResponse(
        renderWorkflowList(
          results as Parameters<typeof renderWorkflowList>[0],
          `Workflows matching "${goal}"`
        )
      )
    }

    // No params -- list all
    const all = (registry.workflows as WorkflowsRegistry).getAllWorkflows()
    if (all.length === 0) {
      return this.formatResponse('No workflows defined.')
    }
    return this.formatResponse(
      renderWorkflowList(all as Parameters<typeof renderWorkflowList>[0], 'Available Workflows')
    )
  }

  /**
   * Format a workflow as roadmap + first step detail.
   *
   * The LLM sees the big picture (roadmap with step titles) but only
   * the first step's tool in detail.
   */
  private _formatWorkflow(w: WorkflowDefinition): string {
    const appToolNames = ((this.serverContext as Record<string, unknown>)?.appToolNames as string[]) ?? []
    const parts: string[] = []

    // Overview: title, description, tags, models
    parts.push(renderWorkflowOverview(w as Parameters<typeof renderWorkflowOverview>[0]))

    // Roadmap: all step titles with brief descriptions
    parts.push(renderRoadmap(w as Parameters<typeof renderRoadmap>[0]))

    // First step in full detail
    if (w.steps.length > 0) {
      parts.push(
        '> **IMPORTANT:** Execute ONLY the step shown below. After completing it, you MUST call `get_workflow_step` to get the next step. Do NOT skip ahead or infer tools from the roadmap \u2014 each step contains critical guidance that is only revealed when you request it.\n'
      )
      parts.push('## Start Here\n')
      const firstStep = w.steps[0]!

      if (firstStep.loopGroup) {
        const { group } = collectStepGroup(
          w.steps as Parameters<typeof collectStepGroup>[0],
          0,
          'loopGroup'
        )
        parts.push(
          renderLoopGroup(group, w as Parameters<typeof renderLoopGroup>[1], { appToolNames })
        )
      } else if (firstStep.parallelGroup) {
        const { group } = collectStepGroup(
          w.steps as Parameters<typeof collectStepGroup>[0],
          0,
          'parallelGroup'
        )
        parts.push(renderParallelGroup(group, { appToolNames }))
        const lastOrder = group[group.length - 1]!.order
        parts.push(renderNextStepHint(w as Parameters<typeof renderNextStepHint>[0], lastOrder))
      } else {
        parts.push(
          renderStepDetail(firstStep as Parameters<typeof renderStepDetail>[0], { appToolNames })
        )
        parts.push(
          renderNextStepHint(w as Parameters<typeof renderNextStepHint>[0], firstStep.order)
        )
      }
    }

    return parts.join('\n')
  }

  private _formatNoResults(goal: string): string {
    const registry = this.domainRegistry as Record<string, unknown>
    const all = (registry.workflows as WorkflowsRegistry).getAllWorkflows()
    const lines = [`No workflows found matching "${goal}".`, '']
    if (all.length > 0) {
      lines.push('Available workflows:')
      for (const w of all) {
        lines.push(`- **${w.title}** (\`${w.name}\`)`)
      }
    }
    return lines.join('\n')
  }
}
