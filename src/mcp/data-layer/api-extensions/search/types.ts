/**
 * Central type definitions for the MCP search module.
 *
 * All search-related interfaces live here to avoid scattering types
 * across base-model, search-adapter, search-service, and api-conventions.
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

import type { SearchRequestShaper } from './request-shapers/default.js'

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
  shaper?: unknown
  shaperConfig?: Record<string, unknown>
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

/**
 * One multi-model search group: the routing half (`endpoint`, `modelsParam`,
 * `shaper`, `queryParam`, `expand`) drives `SearchService.groupSearch`; the
 * presentation half (`label`, `description`, `typeField`, `models`) drives
 * pickers that expose the group. One declaration serves both — registries
 * forward the same object to the data layer and to the picker apps.
 *
 * Group endpoints are namespace-exempt: declare them fully qualified
 * (including any API prefix), since a group spans models and has no single
 * model to resolve a namespace from.
 */
export interface SearchGroup {
  endpoint: string
  modelsParam: string
  shaper?: SearchRequestShaper
  queryParam?: string
  expand?: string[]
  /** Display name pickers show for this group (falls back to the group key). */
  label?: string
  description?: string
  /** Response field carrying each hit's type discriminator (pickers default to `type`). */
  typeField?: string
  /** Member model names — used by pickers for descriptions and type mapping. */
  models?: string[]
  [key: string]: unknown
}

/**
 * The registry-level search knobs. Declared once on `ToolRegistryConfig` /
 * `AppRegistry` options and threaded — typed end-to-end — into
 * `createSearchService`; nothing reads them out of an untyped context bag.
 */
export interface SearchServiceOptions {
  searchGroups?: Record<string, SearchGroup>
  defaultShaper?: SearchRequestShaper
}

export type { NormalizedListResponse, PaginationInfo } from '#src/mcp/data-layer/types.js'

import type { PaginationInfo } from '#src/mcp/data-layer/types.js'

export interface SearchResult {
  records: Record<string, unknown>[]
  pagination: PaginationInfo
}
