/**
 * Strategy Tools
 *
 * These are generic tools that work with prompt strategies.
 * They don't require API authentication and are reusable across servers.
 */

import { GetPromptGuideTool } from './get-prompt-guide-tool.js'
import { ValidateFormTool } from './validate-form-tool.js'
import { GetFormSummaryTool } from './get-form-summary-tool.js'

export { BaseStrategyTool } from './base-strategy-tool.js'
export { GetPromptGuideTool, ValidateFormTool, GetFormSummaryTool }

/** All strategy tool classes mapped by tool name */
export const STRATEGY_TOOL_CLASSES: Record<string, typeof GetPromptGuideTool | typeof ValidateFormTool | typeof GetFormSummaryTool> = {
  get_prompt_guide: GetPromptGuideTool,
  validate_form: ValidateFormTool,
  get_form_summary: GetFormSummaryTool
}
