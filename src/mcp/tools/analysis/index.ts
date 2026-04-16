import { AnalysisClearTool } from './analysis-clear-tool.js'
import { AnalysisQueryTool } from './analysis-query-tool.js'
import { AnalysisStoreTool } from './analysis-store-tool.js'

export { BaseAnalysisTool } from './base-analysis-tool.js'
export { AnalysisClearTool, AnalysisQueryTool, AnalysisStoreTool }

/** All analysis tool classes mapped by tool name */
export const ANALYSIS_TOOL_CLASSES = {
  analysis_store: AnalysisStoreTool,
  analysis_query: AnalysisQueryTool,
  analysis_clear: AnalysisClearTool
}
