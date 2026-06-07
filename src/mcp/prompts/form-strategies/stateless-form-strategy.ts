/**
 * StatelessFormStrategy — docs only; the LLM drives everything else.
 *
 * The simplest of the three form-strategies. The server contributes the
 * prompt's `promptContent` on demand and does no validation, no state
 * tracking, no progress, no defaults. Errors surface at the actual API call
 * (`create_model`), not before. Reach for this first — only graduate to
 * hybrid/stateful when you need server-side validation.
 *
 * Best for prompts with under ~10 fields, no conditionals, and a
 * straightforward "fill, submit" flow.
 *
 * ## Configure on a Prompt class
 *
 *     import { BasePrompt } from '#src/mcp/prompts/base-prompt.js'
 *
 *     export class FeaturePrompt extends BasePrompt {
 *       static formStrategy = 'stateless'
 *
 *       static fieldDefinitions = {
 *         name: { type: 'string', required: true, description: 'Feature name' }
 *       }
 *
 *       get promptContent() {
 *         return `# Create a feature\n\nCollect the name and call create_model.`
 *       }
 *     }
 *
 * `'stateless'` is the default if `static formStrategy` is omitted, so most
 * simple prompts don't need to declare it explicitly.
 *
 * ## MCP tools activated
 *
 * | Tool                | Behavior                              |
 * | ------------------- | ------------------------------------- |
 * | `get_prompt_guide`  | Returns `promptContent` verbatim      |
 * | `validate_form`     | Not supported — returns an error      |
 * | `get_form_summary`  | Not supported                         |
 * | `get_form_progress` | Not supported                         |
 *
 * The LLM reads the guide, gathers fields conversationally, then calls
 * `create_model` directly. Field-level validation happens at the API on
 * submission.
 *
 * ## State
 *
 * None. The LLM is the only stateholder; the server contributes only the
 * documentation string when asked.
 *
 * Flow:
 *
 *     get_prompt_guide → LLM gathers fields → create_model
 */

import { BaseFormStrategy } from './base-form-strategy.js'

export class StatelessFormStrategy extends BaseFormStrategy {
  static override type = 'stateless'

  static override getSupportedOperations(): string[] {
    return ['getDocumentation']
  }

  /** Get prompt content for the prompt */
  static override getDocumentation(promptInstance: {
    promptContent: string
    constructor: { name: string }
  }): string {
    return promptInstance.promptContent
  }

  static getDescription(): string {
    return `Stateless Strategy: Documentation-only approach.
- LLM receives guidance documentation
- No server-side validation before submission
- Errors discovered at API submission time
- Best for simple forms with few fields`
  }
}
