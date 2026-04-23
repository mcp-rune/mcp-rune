// mcp-kit/search — services, adapters, and shared types
export type { RailsAdapterConfig } from './mcp/search/rails-search-adapter.js'
export { RailsSearchAdapter } from './mcp/search/rails-search-adapter.js'
export { SearchAdapter } from './mcp/search/search-adapter.js'
export { SearchService } from './mcp/search/search-service.js'
export type {
  ApiClient,
  PaginationInfo,
  SearchApiClient,
  SearchGroup,
  SearchModelClass,
  SearchResult
} from './mcp/search/types.js'

/** @deprecated Use SearchService instead. */
export { SearchService as SearchClient } from './mcp/search/search-service.js'
