/**
 * SearchAdapter — Default adapter for building search request bodies.
 *
 * Adapters sit between the MCP SearchService and the API, transforming
 * the MCP-generic filter format into the shape each API endpoint expects.
 *
 * ## Data Flow Pipeline
 *
 * Model filter config (Model.search.filters)
 *   → get_filters_guide tells LLM the available filter shapes
 *   → LLM calls search tool with MCP-generic format:
 *       { query, filters: { category_id: 4, status: "active" } }
 *   → SearchAdapter.buildBody() builds the request body
 *   → SearchService POSTs the body to the API endpoint
 *
 * ## Default Behavior
 *
 * The base SearchAdapter spreads filters flat into the request body alongside
 * pagination and query params. This is the most generic behavior and works
 * with APIs that accept filters as top-level POST body params.
 *
 * @example Default flat spread
 * // Input:  query = "Haskell", filters = { category_id: 4, status: "active" }
 * // Output: { q: "Haskell", page: 1, per_page: 20, category_id: 4, status: "active" }
 *
 * For APIs that require filters nested under a key (e.g., Rails conventions),
 * use a subclass like RailsSearchAdapter.
 *
 * Override `buildBody()` in a subclass for more complex transformations.
 */

import type { Pagination, QueryConfig, SearchConfig, SearchRequest } from './types.js'

export class SearchAdapter {
  /**
   * Build the request body for a search API call.
   *
   * Spreads filters flat into the body alongside pagination and query text.
   *
   * @example
   * // Input:
   * //   query = "Haskell"
   * //   filters = { category_id: 4 }
   * // Output:
   * //   { q: "Haskell", page: 1, per_page: 20, category_id: 4 }
   */
  buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    { page, perPage }: Pagination,
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    const queryConfig = searchConfig?.query || ({} as QueryConfig)
    const body: Record<string, unknown> = {
      page,
      per_page: perPage
    }

    if (query) {
      body[queryConfig.queryParam || 'q'] = query
    }

    if (filters && Object.keys(filters).length > 0) {
      Object.assign(body, filters)
    }

    return body
  }

  /**
   * Build the full request for a search API call, including both body and
   * query parameters to append to the URL.
   *
   * Subclasses can override `_buildQueryParams()` to add URL query params
   * (e.g., `?expand=title,platform`) that are separate from the POST body.
   *
   * @example With expand
   * // searchConfig.query.expand = ['title', 'platform']
   * // Returns:
   * //   { body: { q: "test", page: 1, per_page: 20 }, queryParams: "expand=title,platform" }
   */
  buildRequest(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    pagination: Pagination,
    searchConfig: SearchConfig
  ): SearchRequest {
    const body = this.buildBody(query, filters, pagination, searchConfig)
    const queryParams = this._buildQueryParams(searchConfig)
    return { body, queryParams }
  }

  /**
   * Build URL query parameters from search config.
   *
   * Currently supports the `expand` option, which requests the API to inline
   * associated resources in the response (e.g., `?expand=title,platform`).
   */
  protected _buildQueryParams(searchConfig: SearchConfig): string | null {
    const expand = searchConfig?.query?.expand
    if (!expand || expand.length === 0) return null

    return `expand=${expand.join(',')}`
  }
}
