/**
 * StatelessStrategy - Simple documentation-only approach
 *
 * This strategy provides only documentation to guide the LLM.
 * No server-side validation or state management.
 *
 * Operations:
 * - getDocumentation() - Returns static guidance
 *
 * Flow: get_prompt -> LLM guides conversation -> create_model
 *
 * Best for: Simple forms (< 10 fields), no conditionals, straightforward submission
 *
 * Example models: Feature, Clip, Brand
 */

import * as logger from '#src/runtime/logger.js'

import { BaseStrategy } from './base-strategy.js'

export class StatelessStrategy extends BaseStrategy {
  static override type = 'stateless'

  static override getSupportedOperations(): string[] {
    return ['getDocumentation']
  }

  /** Get prompt content for the prompt */
  static override getDocumentation(promptInstance: {
    promptContent: string
    constructor: { name: string }
  }): string {
    const promptContent = promptInstance.promptContent

    logger.debug('getDocumentation called', {
      service: 'strategy',
      strategy: 'stateless',
      promptClass: promptInstance.constructor.name,
      promptContentLength: promptContent?.length || 0
    })

    return promptContent
  }

  static getDescription(): string {
    return `Stateless Strategy: Documentation-only approach.
- LLM receives guidance documentation
- No server-side validation before submission
- Errors discovered at API submission time
- Best for simple forms with few fields`
  }
}
