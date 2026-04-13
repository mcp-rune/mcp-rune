import { BaseTool } from '../base-tool.js'
import type { ToolCategory } from '../categories.js'
import { TOOL_CATEGORIES } from '../categories.js'

/**
 * Base class for memory retrospective tools
 *
 * Sets category to MEMORY (no auth required, needs memory storage).
 */
export class BaseMemoryTool extends BaseTool {
  static override get category(): ToolCategory {
    return TOOL_CATEGORIES.MEMORY
  }
}
