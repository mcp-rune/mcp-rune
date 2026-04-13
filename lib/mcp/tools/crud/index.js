/**
 * Generic CRUD tools for MCP servers.
 *
 * These tools operate on any models registry injected via constructor
 * dependencies and contain zero server-specific logic.
 */

import { ListModelsTool } from './list-models-tool.js'
import { FindModelTool } from './find-model-tool.js'
import { CreateModelTool } from './create-model-tool.js'
import { UpdateModelTool } from './update-model-tool.js'
import { DeleteModelTool } from './delete-model-tool.js'
import { GetNestedResourcesTool } from './get-nested-resources-tool.js'
import { SearchRecordsTool } from './search-records-tool.js'
import { GetFiltersGuideTool } from './get-filters-guide-tool.js'
import { BulkActionModelsTool } from './bulk-action-models-tool.js'
import { BulkGetNestedResourcesTool } from './bulk-get-nested-resources-tool.js'

export {
  ListModelsTool,
  FindModelTool,
  CreateModelTool,
  UpdateModelTool,
  DeleteModelTool,
  GetNestedResourcesTool,
  SearchRecordsTool,
  GetFiltersGuideTool,
  BulkActionModelsTool,
  BulkGetNestedResourcesTool
}

/**
 * All CRUD tool classes mapped by tool name
 */
export const CRUD_TOOL_CLASSES = {
  list_models: ListModelsTool,
  find_model: FindModelTool,
  create_model: CreateModelTool,
  update_model: UpdateModelTool,
  delete_model: DeleteModelTool,
  get_nested_resources: GetNestedResourcesTool,
  get_filters_guide: GetFiltersGuideTool,
  bulk_action_models: BulkActionModelsTool,
  bulk_get_nested_resources: BulkGetNestedResourcesTool
}
