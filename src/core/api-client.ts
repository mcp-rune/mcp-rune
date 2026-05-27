/**
 * Universal CRUD API client interface used across mcp-rune.
 *
 * This is the contract every API client implementation honors —
 * `ModelService` dispatches against it, every tool that requires auth
 * receives one, every MCP App calls it for direct GETs, and the
 * `LoggingApiClient` wrapper implements it. It lives in `core` because
 * it is framework-wide infrastructure that predates and outlives any
 * single feature.
 *
 * Historical note: these interfaces previously lived under
 * `src/mcp/search/types.ts` because `SearchService` was the first
 * non-CRUD consumer to abstract over them. That location was always
 * misleading — `ApiClient` has nothing intrinsically to do with search.
 * Moved to `core` in v0.46.0 as part of the search-extension cleanup.
 */

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

/** Minimal read-only subset used by SearchService and read-only consumers. */
export type SearchApiClient = Pick<ApiClient, 'get' | 'post'>
