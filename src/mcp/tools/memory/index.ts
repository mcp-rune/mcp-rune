import { FindSimilarOperationsTool } from './operations/find-similar-operations-tool.js'
import { DetectOperationGapsTool } from './operations/detect-operation-gaps-tool.js'
import { ClusterOperationsTool } from './operations/cluster-operations-tool.js'
import { AnalysisStoreTool } from './analysis/analysis-store-tool.js'
import { AnalysisQueryTool } from './analysis/analysis-query-tool.js'
import { AnalysisClearTool } from './analysis/analysis-clear-tool.js'

// New analysis_* tool family
export { AnalysisStoreTool, AnalysisQueryTool, AnalysisClearTool }

// Deprecated aliases for backward compatibility
/** @deprecated Use AnalysisStoreTool */
export { AnalysisStoreTool as StoreAnalysisMemoryTool }
/** @deprecated Use AnalysisQueryTool with mode: "semantic" */
export { AnalysisQueryTool as RecallAnalysisMemoriesTool }
/** @deprecated Use AnalysisClearTool */
export { AnalysisClearTool as ClearAnalysisMemoriesTool }

// Operations tools
export { FindSimilarOperationsTool, DetectOperationGapsTool, ClusterOperationsTool }

/** All memory tool classes mapped by tool name */
export const MEMORY_TOOL_CLASSES = {
  find_similar_operations: FindSimilarOperationsTool,
  detect_operation_gaps: DetectOperationGapsTool,
  cluster_operations: ClusterOperationsTool,
  analysis_store: AnalysisStoreTool,
  analysis_query: AnalysisQueryTool,
  analysis_clear: AnalysisClearTool
}
