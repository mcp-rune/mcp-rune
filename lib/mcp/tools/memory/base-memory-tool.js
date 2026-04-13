import { BaseTool } from '../base-tool.js'
import { TOOL_CATEGORIES } from '../categories.js'

/**
 * Base class for memory retrospective tools
 *
 * Sets category to MEMORY (no auth required, needs memory storage).
 */
export class BaseMemoryTool extends BaseTool {
  static get category() {
    return TOOL_CATEGORIES.MEMORY
  }
}
