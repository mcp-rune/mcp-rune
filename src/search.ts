// mcp-rune/search — services, adapters, and search-specific shared types.
// Note: `ApiClient` / `SearchApiClient` moved to `@mcp-rune/mcp-rune/core` in
// v0.46.0 — they were never search-specific.
export type { RailsAdapterConfig } from './mcp/search/rails-search-adapter.js'
export { RailsSearchAdapter } from './mcp/search/rails-search-adapter.js'
export { SearchAdapter } from './mcp/search/search-adapter.js'
export { SearchService } from './mcp/search/search-service.js'
export type {
  PaginationInfo,
  SearchGroup,
  SearchModelClass,
  SearchResult
} from './mcp/search/types.js'
