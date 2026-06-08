import { BaseTool } from '../base-tool.js'
import type { ToolAnnotations } from '../tool-result.js'

/**
 * Base class for operations tools (retrospective analysis of past CRUD
 * operations). Reads from vector storage, no upstream API auth.
 */
export class BaseOperationsTool extends BaseTool {
  static override requiresAuth = false
  static override requiresVectorStorage = true
  static override defaultAnnotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }
}
