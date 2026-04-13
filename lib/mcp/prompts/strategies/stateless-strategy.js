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

import { BaseStrategy } from './base-strategy.js'
import * as logger from '#lib/services/logger.js'

export class StatelessStrategy extends BaseStrategy {
  static type = 'stateless'

  /**
   * Get list of operations this strategy supports
   * @returns {string[]}
   */
  static getSupportedOperations() {
    return ['getDocumentation']
  }

  /**
   * Get prompt content for the prompt
   * @param {Object} promptInstance - Instance of the prompt class
   * @returns {string}
   */
  static getDocumentation(promptInstance) {
    const promptContent = promptInstance.promptContent

    logger.debug('getDocumentation called', {
      service: 'strategy',
      strategy: 'stateless',
      promptClass: promptInstance.constructor.name,
      promptContentLength: promptContent?.length || 0
    })

    return promptContent
  }

  /**
   * Get strategy description for documentation
   * @returns {string}
   */
  static getDescription() {
    return `Stateless Strategy: Documentation-only approach.
- LLM receives guidance documentation
- No server-side validation before submission
- Errors discovered at API submission time
- Best for simple forms with few fields`
  }
}
