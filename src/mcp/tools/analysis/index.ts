import { AnalysisStoreTool } from './analysis-store-tool.js'
import { AnalysisQueryTool } from './analysis-query-tool.js'
import { AnalysisClearTool } from './analysis-clear-tool.js'

export { BaseAnalysisTool } from './base-analysis-tool.js'
export { AnalysisStoreTool, AnalysisQueryTool, AnalysisClearTool }

/** All analysis tool classes mapped by tool name */
export const ANALYSIS_TOOL_CLASSES = {
  analysis_store: AnalysisStoreTool,
  analysis_query: AnalysisQueryTool,
  analysis_clear: AnalysisClearTool
}
