/**
 * Generic data tools for MCP servers.
 *
 * These tools operate on any models registry injected via constructor
 * dependencies and contain zero server-specific logic.
 *
 * Covers CRUD operations, bulk operations, search, and discovery.
 */

import { AnalysisIngestTool } from './analysis-ingest-tool.js'
import { BulkActionModelsTool } from './bulk-action-models-tool.js'
import { CreateModelTool } from './create-model-tool.js'
import { DeleteModelTool } from './delete-model-tool.js'
import { FindModelTool } from './find-model-tool.js'
import { GetFiltersGuideTool } from './get-filters-guide-tool.js'
import { ListModelsTool } from './list-models-tool.js'
import { ModelActionTool } from './model-action-tool.js'
import { SearchRecordsTool } from './search-records-tool.js'
import { UpdateModelTool } from './update-model-tool.js'

export {
  AnalysisIngestTool,
  BulkActionModelsTool,
  CreateModelTool,
  DeleteModelTool,
  FindModelTool,
  GetFiltersGuideTool,
  ListModelsTool,
  ModelActionTool,
  SearchRecordsTool,
  UpdateModelTool
}

/** All data tool classes mapped by tool name */
export const DATA_TOOL_CLASSES = {
  list_models: ListModelsTool,
  find_model: FindModelTool,
  create_model: CreateModelTool,
  update_model: UpdateModelTool,
  delete_model: DeleteModelTool,
  get_filters_guide: GetFiltersGuideTool,
  bulk_action_models: BulkActionModelsTool,
  analysis_ingest: AnalysisIngestTool,
  model_action: ModelActionTool
}
