import { BaseTool } from '../base-tool.js'
import type { ToolAnnotations } from '../tool-result.js'

/**
 * Base class for analysis tools (qualitative analysis sessions backed by
 * vector storage). No upstream API auth by default — subclasses that
 * fetch from the API (e.g. `AnalysisIngestTool`, `AnalysisActTool`) opt
 * back in with `static override requiresAuth = true`.
 */
export class BaseAnalysisTool extends BaseTool {
  static override requiresAuth = false
  static override requiresVectorStorage = true
  static override defaultAnnotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }
}
