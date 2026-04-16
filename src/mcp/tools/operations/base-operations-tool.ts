import { BaseTool } from '../base-tool.js'
import type { ToolCategory } from '../categories.js'
import { TOOL_CATEGORIES } from '../categories.js'

/**
 * Base class for operations tools
 *
 * Sets category to OPERATIONS (no auth required, needs vector storage).
 */
export class BaseOperationsTool extends BaseTool {
  static override get category(): ToolCategory {
    return TOOL_CATEGORIES.OPERATIONS
  }
}
