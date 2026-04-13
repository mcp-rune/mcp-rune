import { z } from 'zod'
import { BaseDomainTool } from './base-domain-tool.js'
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

/**
 * Suggest a workflow for a given goal
 *
 * Returns a workflow roadmap (step titles) plus the first step in full detail.
 * The LLM executes one step at a time, calling get_workflow_step for each
 * subsequent step. This prompt-chaining approach scopes tool context per step,
 * preventing the LLM from substituting similar-looking tools.
 */
export class SuggestWorkflowTool extends BaseDomainTool {
  get name() {
    return 'suggest_workflow'
  }

  get baseDescription() {
    return `Get a structured multi-step workflow for a goal. Returns a roadmap of all steps plus the first step in detail. Use get_workflow_step to advance through subsequent steps.

USE THIS TOOL WHEN:
- Troubleshooting "No rights" or "In conflict" status on schedule entries
- Setting up complex features like catch-up VOD or licensing deals
- Learning how entities interact (requirements system, deal → rights flow)
- Orchestrating multi-step processes spanning multiple entities

Available workflows include troubleshooting guides, configuration walkthroughs, and learning paths.`
  }

  get inputSchema() {
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

  async execute(args) {
    this.requireDomainRegistry()
    const { goal, workflow, tag } = args

    // Exact workflow lookup
    if (workflow) {
      const w = this.domainRegistry.getWorkflow(workflow)
      if (!w) {
        const all = this.domainRegistry.workflows.getAllWorkflows()
        const names = all.map((w) => `\`${w.name}\``).join(', ')
        return this.formatResponse(`Workflow "${workflow}" not found. Available: ${names}`)
      }
      return this.formatResponse(this._formatWorkflow(w))
    }

    // Tag filtering
    if (tag) {
      const results = this.domainRegistry.getWorkflowsByTag(tag)
      if (results.length === 0) {
        return this.formatResponse(`No workflows found with tag "${tag}".`)
      }
      if (results.length === 1) {
        return this.formatResponse(this._formatWorkflow(results[0]))
      }
      return this.formatResponse(renderWorkflowList(results, `Workflows tagged "${tag}"`))
    }

    // Goal search
    if (goal) {
      const results = await this.domainRegistry.suggestWorkflow(goal)
      if (results.length === 0) {
        return this.formatResponse(this._formatNoResults(goal))
      }
      if (results.length === 1) {
        return this.formatResponse(this._formatWorkflow(results[0]))
      }
      return this.formatResponse(renderWorkflowList(results, `Workflows matching "${goal}"`))
    }

    // No params — list all
    const all = this.domainRegistry.workflows.getAllWorkflows()
    if (all.length === 0) {
      return this.formatResponse('No workflows defined.')
    }
    return this.formatResponse(renderWorkflowList(all, 'Available Workflows'))
  }

  /**
   * Format a workflow as roadmap + first step detail.
   *
   * The LLM sees the big picture (roadmap with step titles) but only
   * the first step's tool in detail. Subsequent steps are retrieved
   * via get_workflow_step.
   */
  _formatWorkflow(w) {
    const appToolNames = this.serverContext?.appToolNames || []
    const parts = []

    // Overview: title, description, tags, models
    parts.push(renderWorkflowOverview(w))

    // Roadmap: all step titles with brief descriptions
    parts.push(renderRoadmap(w))

    // First step in full detail
    if (w.steps.length > 0) {
      parts.push(
        '> **IMPORTANT:** Execute ONLY the step shown below. After completing it, you MUST call `get_workflow_step` to get the next step. Do NOT skip ahead or infer tools from the roadmap — each step contains critical guidance that is only revealed when you request it.\n'
      )
      parts.push('## Start Here\n')
      const firstStep = w.steps[0]

      if (firstStep.loopGroup) {
        const { group } = collectStepGroup(w.steps, 0, 'loopGroup')
        parts.push(renderLoopGroup(group, w, { appToolNames }))
      } else if (firstStep.parallelGroup) {
        const { group } = collectStepGroup(w.steps, 0, 'parallelGroup')
        parts.push(renderParallelGroup(group, { appToolNames }))
        const lastOrder = group[group.length - 1].order
        parts.push(renderNextStepHint(w, lastOrder))
      } else {
        parts.push(renderStepDetail(firstStep, { appToolNames }))
        parts.push(renderNextStepHint(w, firstStep.order))
      }
    }

    return parts.join('\n')
  }

  _formatNoResults(goal) {
    const all = this.domainRegistry.workflows.getAllWorkflows()
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
