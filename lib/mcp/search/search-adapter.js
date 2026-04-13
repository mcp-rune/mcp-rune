/**
 * SearchAdapter — Default adapter for building search request bodies.
 *
 * Adapters sit between the MCP SearchClient and the Rails API, transforming
 * the MCP-generic filter format into the shape each API endpoint expects.
 *
 * ## Data Flow Pipeline
 *
 * Model filter config (Model.search.filters)
 *   → get_filters_guide tells LLM the available filter shapes
 *   → LLM calls search tool with MCP-generic format:
 *       { query, filters: { category_id: 4, duration_minutes: { from: 40 } } }
 *   → SearchAdapter.buildBody() transforms to API-specific body
 *   → SearchClient POSTs the body to the API endpoint
 *
 * ## Default Behavior
 *
 * The default adapter passes filters through unchanged. Override `buildBody()`
 * in a subclass when the API expects a different shape (e.g., flat range keys
 * instead of nested `{ from, to }` objects).
 */
export class SearchAdapter {
  /**
   * Build the request body for a search API call.
   *
   * @param {string|null} query - Text search query
   * @param {Object} [filters] - MCP-generic filters from the LLM
   * @param {Object} pagination - Pagination options
   * @param {number} pagination.page - Page number
   * @param {number} pagination.perPage - Results per page
   * @param {Object} searchConfig - Model's static `search` config
   * @returns {Object} Request body ready for the API
   *
   * @example Default pass-through
   * // Input:
   * //   query = "Haskell"
   * //   filters = { category_id: 4 }
   * // Output:
   * //   { q: "Haskell", page: 1, per_page: 20, filters: { category_id: 4 } }
   *
   * @example No query, filters only
   * // Input:
   * //   query = null
   * //   filters = { theme_id: 1 }
   * // Output:
   * //   { q: "Haskell", page: 1, per_page: 20, filters: { theme_id: 1 } }
   */
  buildBody(query, filters, { page, perPage }, searchConfig) {
    const fullText = searchConfig?.fullText || {}
    const body = {
      page,
      per_page: perPage
    }

    if (query) {
      body[fullText.queryParam || 'q'] = query
    }

    if (filters && Object.keys(filters).length > 0 && fullText.filtersParam) {
      body[fullText.filtersParam] = filters
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
   * @param {string|null} query - Text search query
   * @param {Object} [filters] - MCP-generic filters from the LLM
   * @param {Object} pagination - Pagination options
   * @param {number} pagination.page - Page number
   * @param {number} pagination.perPage - Results per page
   * @param {Object} searchConfig - Model's static `search` config
   * @returns {{ body: Object, queryParams: string|null }}
   *
   * @example With expand
   * // searchConfig.fullText.expand = ['title', 'platform']
   * // Returns:
   * //   { body: { q: "test", page: 1, per_page: 20 }, queryParams: "expand=title,platform" }
   */
  buildRequest(query, filters, pagination, searchConfig) {
    const body = this.buildBody(query, filters, pagination, searchConfig)
    const queryParams = this._buildQueryParams(searchConfig)
    return { body, queryParams }
  }

  /**
   * Build URL query parameters from search config.
   *
   * Currently supports the `expand` option, which requests the API to inline
   * associated resources in the response (e.g., `?expand=title,platform`).
   *
   * @param {Object} searchConfig - Model's static `search` config
   * @returns {string|null} Query string (without leading `?`) or null
   * @protected
   */
  _buildQueryParams(searchConfig) {
    const expand = searchConfig?.fullText?.expand
    if (!expand || expand.length === 0) return null

    return `expand=${expand.join(',')}`
  }
}
