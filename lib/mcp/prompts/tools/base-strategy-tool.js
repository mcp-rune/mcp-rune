/**
 * Base class for strategy-related tools
 *
 * Strategy tools:
 * - Don't require API authentication
 * - Work with prompt classes and strategies
 * - Are generic and reusable across servers
 *
 * Examples: get_prompt_guide, validate_form, get_form_summary, get_form_progress
 */

import { BaseTool } from '#lib/mcp/tools/base-tool.js'
import { TOOL_CATEGORIES } from '#lib/mcp/tools/categories.js'
import { getStrategy } from '../strategies/index.js'

export class BaseStrategyTool extends BaseTool {
  /**
   * Strategy tools don't require authentication
   */
  static get category() {
    return TOOL_CATEGORIES.STRATEGY
  }

  /**
   * Get strategy for a prompt class
   * @param {Object} promptClass - Prompt class with strategy property
   * @returns {Object} Strategy class
   */
  getStrategy(promptClass) {
    const strategyType = promptClass.strategy || 'stateless'
    return getStrategy(strategyType)
  }

  /**
   * Get prompt class by model name
   * @param {string} model - Model name
   * @returns {Object|null} Prompt class or null
   */
  getPromptClassByModel(model) {
    if (!this.promptRegistry?.getPromptClassByModel) {
      throw new Error('Prompt registry not available')
    }
    return this.promptRegistry.getPromptClassByModel(model)
  }

  /**
   * Get prompt name by model name
   * @param {string} model - Model name
   * @returns {string|null} Prompt name or null
   */
  getPromptNameByModel(model) {
    if (!this.promptRegistry?.getPromptNameByModel) {
      return null
    }
    return this.promptRegistry.getPromptNameByModel(model)
  }

  /**
   * Helper to check if strategy supports an operation
   * @param {Object} strategy - Strategy class
   * @param {string} operation - Operation name
   * @param {string} model - Model name (for error message)
   * @returns {Object} { supported: boolean, error?: Object }
   */
  checkOperation(strategy, operation, model) {
    if (!strategy.supportsOperation(operation)) {
      const strategyType = strategy.name || 'unknown'
      return {
        supported: false,
        error: {
          error: `Model "${model}" uses ${strategyType} strategy which doesn't support ${operation}`,
          hint: this._getOperationHint(operation),
          strategy: strategyType,
          supported_operations: strategy.getSupportedOperations()
        }
      }
    }
    return { supported: true }
  }

  /**
   * Get hint message for unsupported operation
   * @param {string} operation - Operation name
   * @returns {string} Hint message
   * @private
   */
  _getOperationHint(operation) {
    const hints = {
      validateFields: 'Submit directly with create_model - validation will occur at API level',
      validateSection: 'Use validate_form without section parameter for full validation',
      getProgress: 'Progress tracking is only available for stateful models',
      generateSummary: 'Generate the summary in your response based on the collected fields'
    }
    return hints[operation] || 'Check supported operations for this strategy'
  }

  /**
   * Format unknown model error
   * @param {string} model - Model name
   * @returns {Object} Formatted error response
   */
  formatUnknownModelError(model) {
    const promptName = this.getPromptNameByModel(model)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: `Unknown model: ${model}`,
              hint: promptName
                ? `Use guide_name: "${promptName}" with get_prompt_guide first`
                : 'Check available models with list_models'
            },
            null,
            2
          )
        }
      ],
      isError: true
    }
  }

  /**
   * Format operation not supported error
   * @param {Object} errorInfo - Error information from checkOperation
   * @returns {Object} Formatted error response
   */
  formatOperationError(errorInfo) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(errorInfo, null, 2)
        }
      ],
      isError: true
    }
  }
}
