/**
 * Public surface of the `search` ApiExtension.
 *
 * The extension owns the entire search subsystem post-v0.47.0:
 *   - The MCP tools (`search_records`, `get_filters_guide`)
 *   - The `SearchService` engine + `SearchAdapter` / `RailsSearchAdapter`
 *     used by apps and `analysis-ingest-tool` as a shared module import
 *   - The typed capability readers consumed by every place that needs to
 *     interrogate a model's search config (extension, apps, analysis-ingest,
 *     list-models, validators)
 *   - The `createSearchService` factory all instantiation sites route through
 *
 * Conventional registration key when adding to `ToolRegistry`: `search`.
 *
 * ```ts
 * import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
 * import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'
 *
 * new ToolRegistry({
 *   toolClasses: DATA_TOOL_CLASSES,
 *   models: MODEL_CLASSES,
 *   createApiClient,
 *   apiExtensions: { search: searchExtension() }
 * })
 * ```
 */

export type { ModelWithExtensions } from './capabilities.js'
export {
  getLookupableModelNames,
  getModelFilters,
  getQueryableModelNames,
  getSearchableModelNames,
  getSearchConfig,
  searchConfig
} from './capabilities.js'
export { GetFiltersGuideTool, searchExtension, SearchRecordsTool } from './extension.js'
export type { SearchFactoryContext } from './factory.js'
export { createSearchService } from './factory.js'
export type { RailsAdapterConfig } from './rails-search-adapter.js'
export { RailsSearchAdapter } from './rails-search-adapter.js'
export { SearchAdapter } from './search-adapter.js'
export { SearchService } from './search-service.js'
export type {
  LookupConfig,
  NormalizedListResponse,
  Pagination,
  PaginationInfo,
  QueryConfig,
  SearchConfig,
  SearchGroup,
  SearchModelClass,
  SearchRequest,
  SearchResult
} from './types.js'
