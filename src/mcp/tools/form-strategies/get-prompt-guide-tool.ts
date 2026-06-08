/**
 * Tool for getting step-by-step prompt guides
 *
 * This is a strategy tool that doesn't require API authentication.
 * It retrieves documentation for creating complex models.
 */

import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ToolResult } from '#src/mcp/tools/tool-result.js'

import { BaseFormStrategyTool } from './base-form-strategy-tool.js'

export class GetPromptGuideTool extends BaseFormStrategyTool {
  get name(): string {
    return 'get_prompt_guide'
  }

  get baseDescription(): string {
    return 'Get step-by-step guidance documentation for creating complex models.'
  }

  get inputSchema(): Record<string, ZodTypeAny> {
    const allGuideNames = this.promptRegistry?.getAllPromptNames?.() || []

    return {
      guide_name: this.zodEnum(allGuideNames).describe('Name of the guide to retrieve'),
      mode: z
        .enum(['guided', 'quick'])
        .default('guided')
        .describe(
          'Interaction mode: "guided" asks user for input on each section, "quick" infers values from context and asks only for required fields that cannot be inferred'
        )
        .optional(),
      parent_type: z
        .string()
        .describe('Optional: Type of parent content if already known')
        .optional(),
      parent_id: z.string().describe('Optional: ID of parent content if already known').optional()
    }
  }

  getUsageRules(): string[] {
    const rules: string[] = []

    // Determine which models have Interactive Form support
    const formRegistry = (this.serverContext as Record<string, unknown>)?.formRegistry as
      | Record<string, unknown>
      | undefined
    const formModels = formRegistry
      ? Object.entries(this.models || {})
          .filter(([name]) =>
            (formRegistry as Record<string, unknown> & { hasForm: (n: string) => boolean }).hasForm(
              name
            )
          )
          .map(([name]) => name)
      : []
    const hasFormModels =
      (this.serverContext as Record<string, unknown>)?.appsEnabled && formModels.length > 0

    if (hasFormModels) {
      rules.push(
        `IMPORTANT: Before calling this tool, ASK the user how they want to proceed.

For models that support Interactive Form (${formModels.join(', ')}), offer THREE options:

Example:
  User: "Create a book"
  You: "I can help create a book. How would you like to proceed?
    1. **Interactive Form** - I'll open a visual form where you can fill in all fields at once
    2. **Guided** - I'll walk you through each section step-by-step and ask for your input
    3. **Quick** - I'll infer what I can from context and ask only for essentials"

If the user chooses **Interactive Form**, call \`new_model_app(model: "<model_name>", mode: "form")\` instead of this tool.
If the user chooses **Guided** or **Quick**, call this tool with the chosen mode parameter.

For all other models, offer only Guided and Quick options.`
      )
    } else {
      rules.push(
        `IMPORTANT: Before calling this tool, ASK the user how they want to proceed.

Offer TWO options:

Example:
  User: "Create a study session"
  You: "I can help create a study session. How would you like to proceed?
    1. **Guided** - I'll walk you through each section and ask for your input
    2. **Quick** - I'll infer what I can from context and ask only for essentials"

Then call this tool with the chosen mode parameter.`
      )
    }

    if (this.promptRegistry?.getToolDocDescriptionList) {
      const allGuidesList = this.promptRegistry.getToolDocDescriptionList()
      rules.push(`Available guides:\n${allGuidesList}`)
    }

    rules.push(
      `The returned documentation contains:
- Field definitions and constraints
- Valid attribute values and their meanings
- Validation workflow instructions
- Examples and templates

After calling this tool, follow the mode-specific workflow in the documentation.`
    )

    return rules
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      guide_name,
      mode = 'guided',
      parent_type,
      parent_id
    } = args as {
      guide_name: string
      mode?: string
      parent_type?: string
      parent_id?: string
    }

    if (this.logger) {
      this.logger.info('get_prompt_guide invoked', {
        service: 'mcp-tools',
        tool: 'get_prompt_guide',
        guide_name,
        mode,
        parent_type,
        parent_id
      })
    }

    if (!this.promptRegistry) {
      throw new Error('Prompt registry not available')
    }

    const promptArgs: Record<string, string> = { mode }
    if (parent_type) promptArgs.parent_type = parent_type
    if (parent_id) promptArgs.parent_id = parent_id

    const registry = this.promptRegistry

    // Use registry to get prompt instance — prefer the deployer's explicit hook,
    // fall back to constructing the prompt class with args. Guard with
    // `typeof === 'function'` so misshapen registries fall back rather than throw.
    const getPromptInstance =
      typeof registry.getPromptInstance === 'function'
        ? registry.getPromptInstance.bind(registry)
        : (name: string, pArgs: Record<string, string>) => {
            const PromptCtor = registry.getPromptClass(name) as unknown as
              | (new (a: Record<string, string>) => { promptContent: string; description: string })
              | null
            return PromptCtor ? new PromptCtor(pArgs) : null
          }

    const getUnknownPromptError =
      typeof registry.getUnknownPromptError === 'function'
        ? registry.getUnknownPromptError.bind(registry)
        : (name: string) => `Unknown prompt: ${name}`

    const prompt =
      typeof getPromptInstance === 'function' ? getPromptInstance(guide_name, promptArgs) : null

    if (!prompt) {
      const errorMessage =
        typeof getUnknownPromptError === 'function'
          ? getUnknownPromptError(guide_name)
          : `Unknown prompt: ${guide_name}`

      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ],
        isError: true
      }
    }

    const promptContent = prompt.promptContent
    const description = prompt.description

    if (this.logger) {
      this.logger.info('get_prompt_guide returning prompt content', {
        service: 'mcp-tools',
        tool: 'get_prompt_guide',
        guide_name,
        promptContentLength: promptContent?.length || 0
      })
    }

    return {
      content: [
        {
          type: 'text',
          text: `# ${description}\n\n${promptContent}`
        }
      ]
    }
  }
}
