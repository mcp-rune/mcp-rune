import { BaseTool } from '../base-tool.js'
import type { ToolCategory } from '../categories.js'
import { TOOL_CATEGORIES } from '../categories.js'

/**
 * Base class for analysis tools
 *
 * Sets category to ANALYSIS (no auth required, needs vector storage).
 */
export class BaseAnalysisTool extends BaseTool {
  static override get category(): ToolCategory {
    return TOOL_CATEGORIES.ANALYSIS
  }
}
