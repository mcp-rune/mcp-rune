import { FindSimilarOperationsTool } from './find-similar-operations-tool.js'
import { DetectOperationGapsTool } from './detect-operation-gaps-tool.js'
import { ClusterOperationsTool } from './cluster-operations-tool.js'

export { BaseOperationsTool } from './base-operations-tool.js'
export { FindSimilarOperationsTool, DetectOperationGapsTool, ClusterOperationsTool }

/** All operations tool classes mapped by tool name */
export const OPERATIONS_TOOL_CLASSES = {
  find_similar_operations: FindSimilarOperationsTool,
  detect_operation_gaps: DetectOperationGapsTool,
  cluster_operations: ClusterOperationsTool
}
