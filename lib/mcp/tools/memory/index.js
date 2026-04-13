import { FindSimilarOperationsTool } from './operations/find-similar-operations-tool.js'
import { DetectOperationGapsTool } from './operations/detect-operation-gaps-tool.js'
import { ClusterOperationsTool } from './operations/cluster-operations-tool.js'
import { StoreAnalysisMemoryTool } from './analysis/store-analysis-memory-tool.js'
import { RecallAnalysisMemoriesTool } from './analysis/recall-analysis-memories-tool.js'
import { ClearAnalysisMemoriesTool } from './analysis/clear-analysis-memories-tool.js'

export {
  FindSimilarOperationsTool,
  DetectOperationGapsTool,
  ClusterOperationsTool,
  StoreAnalysisMemoryTool,
  RecallAnalysisMemoriesTool,
  ClearAnalysisMemoriesTool
}

/**
 * All memory tool classes mapped by tool name
 */
export const MEMORY_TOOL_CLASSES = {
  find_similar_operations: FindSimilarOperationsTool,
  detect_operation_gaps: DetectOperationGapsTool,
  cluster_operations: ClusterOperationsTool,
  store_analysis_memory: StoreAnalysisMemoryTool,
  recall_analysis_memories: RecallAnalysisMemoriesTool,
  clear_analysis_memories: ClearAnalysisMemoriesTool
}
