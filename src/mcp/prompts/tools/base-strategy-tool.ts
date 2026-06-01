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

import type { ToolAnnotations, ToolResult } from '#src/mcp/tools/base-tool.js'
import { BaseTool } from '#src/mcp/tools/base-tool.js'

import type { PromptClassLike, StrategyType } from '../base-prompt.js'
import type { BaseStrategy } from '../strategies/base-strategy.js'
import { getStrategy } from '../strategies/index.js'

/** Error info returned by checkOperation */
interface OperationCheckResult {
  supported: boolean
  error?: {
    error: string
    hint: string
    strategy: string
    supported_operations: string[]
  }
}

export class BaseStrategyTool extends BaseTool {
  static override requiresAuth = false
  static override requiresPromptRegistry = true
  static override defaultAnnotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }

  /** Get strategy for a prompt class */
  getStrategy(promptClass: { strategy?: StrategyType }): typeof BaseStrategy {
    const strategyType = promptClass.strategy || 'stateless'
    return getStrategy(strategyType)
  }

  /** Get prompt class by model name */
  getPromptClassByModel(model: string): PromptClassLike | null {
    if (!this.promptRegistry?.getPromptClassByModel) {
      throw new Error('Prompt registry not available')
    }
    return this.promptRegistry.getPromptClassByModel(model) as PromptClassLike | null
  }

  /** Get prompt name by model name */
  getPromptNameByModel(model: string): string | null {
    if (!this.promptRegistry?.getPromptNameByModel) {
      return null
    }
    return this.promptRegistry.getPromptNameByModel(model)
  }

  /** Helper to check if strategy supports an operation */
  checkOperation(
    strategy: typeof BaseStrategy,
    operation: string,
    model: string
  ): OperationCheckResult {
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

  /** Get hint message for unsupported operation */
  private _getOperationHint(operation: string): string {
    const hints: Record<string, string> = {
      validateFields: 'Submit directly with create_model - validation will occur at API level',
      validateSection: 'Use validate_form without section parameter for full validation',
      getProgress: 'Progress tracking is only available for stateful models',
      generateSummary: 'Generate the summary in your response based on the collected fields'
    }
    return hints[operation] || 'Check supported operations for this strategy'
  }

  /** Format unknown model error */
  formatUnknownModelError(model: string): ToolResult {
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

  /** Format operation not supported error */
  formatOperationError(errorInfo: Record<string, unknown>): ToolResult {
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
