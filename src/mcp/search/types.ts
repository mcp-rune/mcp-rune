/**
 * Central type definitions for the MCP search module.
 *
 * All search-related interfaces live here to avoid scattering types
 * across base-model, search-adapter, search-client, and api-conventions.
 */

import type { BaseConvention } from '#src/mcp/api-conventions/base-convention.js'

import type { SearchAdapter } from './search-adapter.js'

// ============================================================================
// API Client
// ============================================================================

/** Options passed to API client methods (e.g., userId impersonation). */
export interface RequestOptions {
  userId?: string
  [key: string]: unknown
}

/** Full CRUD API client interface used across tools, apps, and search. */
export interface ApiClient {
  baseUrl?: string
  get(
    url: string,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  post(
    url: string,
    data?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  put(
    url: string,
    data?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  patch(
    url: string,
    data?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>
  delete(url: string, options?: RequestOptions): Promise<Record<string, unknown>>
}

/** Minimal read-only subset used by SearchClient. */
export type SearchApiClient = Pick<ApiClient, 'get' | 'post'>

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
  endpoint: string
  singularName?: string
  search?: SearchConfig | null
  api?: {
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

export interface PaginationInfo {
  page: number
  per_page: number
  total: number
  total_pages?: number
}

export interface SearchResult {
  records: Record<string, unknown>[]
  pagination: PaginationInfo
}

export interface NormalizedListResponse {
  records: Record<string, unknown>[]
  pagination: PaginationInfo
}
