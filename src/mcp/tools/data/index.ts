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
import { BulkGetNestedResourcesTool } from './bulk-get-nested-resources-tool.js'
import { CreateModelTool } from './create-model-tool.js'
import { DeleteModelTool } from './delete-model-tool.js'
import { FindModelTool } from './find-model-tool.js'
import { GetFiltersGuideTool } from './get-filters-guide-tool.js'
import { GetNestedResourcesTool } from './get-nested-resources-tool.js'
import { ListModelsTool } from './list-models-tool.js'
import { SearchRecordsTool } from './search-records-tool.js'
import { UpdateModelTool } from './update-model-tool.js'

export {
  AnalysisIngestTool,
  BulkActionModelsTool,
  BulkGetNestedResourcesTool,
  CreateModelTool,
  DeleteModelTool,
  FindModelTool,
  GetFiltersGuideTool,
  GetNestedResourcesTool,
  ListModelsTool,
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
  get_nested_resources: GetNestedResourcesTool,
  get_filters_guide: GetFiltersGuideTool,
  bulk_action_models: BulkActionModelsTool,
  bulk_get_nested_resources: BulkGetNestedResourcesTool,
  analysis_ingest: AnalysisIngestTool
}

/** @deprecated Use DATA_TOOL_CLASSES */
export const CRUD_TOOL_CLASSES = DATA_TOOL_CLASSES
