/**
 * Central type definitions for the MCP search module.
 *
 * All search-related interfaces live here to avoid scattering types
 * across base-model, search-adapter, search-service, and api-conventions.
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

import type { SearchAdapter } from './search-adapter.js'

// ============================================================================
// Model search configuration (declared on model classes)
// ============================================================================

export interface LookupConfig {
  endpoint?: string
  fields: string[]
  queryParam?: string
}

export interface QueryConfig {
  endpoint?: string
  group?: string
  modelName?: string | string[]
  method?: 'POST' | 'GET'
  queryParam?: string
  expand?: string[]
  adapter?: unknown
  adapterConfig?: Record<string, unknown>
}

export interface SearchConfig {
  lookup?: LookupConfig
  query?: QueryConfig
  filters?: Record<string, unknown>
}

// ============================================================================
// Search adapter types
// ============================================================================

export interface Pagination {
  page: number
  perPage: number
}

export interface SearchRequest {
  body: Record<string, unknown>
  queryParams: string | null
}

// ============================================================================
// Search client types
// ============================================================================

export interface SearchModelClass {
  singularName?: string
  /**
   * Search config lives on `extensions['search']` (read via `getSearchConfig`).
   * `SearchService` does not access this field directly — it always goes
   * through the capability getter so the bag layout can evolve in one place.
   */
  extensions?: Record<string, unknown>
  api: {
    endpoint: string
    convention?: BaseConvention
    readOnly?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SearchGroup {
  endpoint: string
  modelsParam: string
  adapter?: SearchAdapter
  queryParam?: string
  expand?: string[]
  [key: string]: unknown
}

export type { NormalizedListResponse, PaginationInfo } from '#src/mcp/data-layer/types.js'

import type { PaginationInfo } from '#src/mcp/data-layer/types.js'

export interface SearchResult {
  records: Record<string, unknown>[]
  pagination: PaginationInfo
}
