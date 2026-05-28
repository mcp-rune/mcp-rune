import { AnalysisActTool } from './analysis-act-tool.js'
import { AnalysisClearTool } from './analysis-clear-tool.js'
import { AnalysisIngestTool } from './analysis-ingest-tool.js'
import { AnalysisQueryTool } from './analysis-query-tool.js'
import { AnalysisStoreTool } from './analysis-store-tool.js'
import { AnalysisSummarizeTool } from './analysis-summarize-tool.js'

export { BaseAnalysisTool } from './base-analysis-tool.js'
export {
  AnalysisActTool,
  AnalysisClearTool,
  AnalysisIngestTool,
  AnalysisQueryTool,
  AnalysisStoreTool,
  AnalysisSummarizeTool
}

/** All analysis tool classes mapped by tool name */
export const ANALYSIS_TOOL_CLASSES = {
  analysis_ingest: AnalysisIngestTool,
  analysis_store: AnalysisStoreTool,
  analysis_query: AnalysisQueryTool,
  analysis_act: AnalysisActTool,
  analysis_clear: AnalysisClearTool,
  analysis_summarize: AnalysisSummarizeTool
}
