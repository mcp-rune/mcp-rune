/**
 * SearchService -- Normalized search interface for MCP apps and tools.
 *
 * Wraps apiClient to provide a consistent search API regardless of
 * whether a model has its own search endpoint, delegates to a group
 * search endpoint, or only supports listing.
 *
 *   MCP App/Tool -> SearchService -> apiClient -> API
 *
 * Three entry points:
 * - search()  — structured query with filters (POST or group-based)
 * - lookup()  — typeahead/autocomplete for finding records by name
 * - list()    — paginated GET listing (always available)
 *
 * For both direct and group search endpoints, the request body is built by a
 * SearchAdapter. The adapter can be set at three levels (highest priority first):
 * 1. Per-model: `search.query.adapter`
 * 2. Per-group: `searchGroup.adapter`
 * 3. Server-wide: `defaultAdapter` in the SearchService constructor
 *
 * The base SearchAdapter spreads filters flat into the body. For Rails-style
 * nesting (e.g., `{ filters: { ... } }`), use RailsSearchAdapter.
 *
 * CRUD operations still use apiClient directly via Model.endpoint.
 */

import type { SearchApiClient } from '#src/core/api-client.js'
import { defaultConvention } from '#src/mcp/api-conventions/index.js'

import { SearchAdapter } from './search-adapter.js'
import type {
  PaginationInfo,
  SearchConfig,
  SearchGroup,
  SearchModelClass,
  SearchResult
} from './types.js'

export class SearchService {
  private _apiClient: SearchApiClient
  private _searchGroups: Record<string, SearchGroup>
  private _defaultAdapter: SearchAdapter

  constructor(
    apiClient: SearchApiClient,
    {
      searchGroups = {},
      defaultAdapter = new SearchAdapter()
    }: {
      searchGroups?: Record<string, SearchGroup>
      defaultAdapter?: SearchAdapter
    } = {}
  ) {
    this._apiClient = apiClient
    this._searchGroups = searchGroups
    this._defaultAdapter = defaultAdapter
  }

  /**
   * Structured search for a single model.
   *
   * @param ModelClass - A model class (or plain object) conforming to SearchModelClass.
   *   Must provide `endpoint` and optionally `search` config to control routing.
   * @param query - Text query string passed to the search endpoint.
   * @param options - Pagination and filter options.
   *
   * Resolution order:
   * 1. model.search.query.endpoint -> direct endpoint (POST or GET)
   * 2. model.search.query.group -> group search filtered to this model type
   *    Uses query.modelName if set, otherwise falls back to singularName.
   *    modelName can be a string or array (e.g., ['episode', 'feature']).
   * 3. Neither -> field-based search on first lookup field via list()
   *
   * @example Path 1 — Direct endpoint (POST with flat filters)
   * static search = {
   *   query: {
   *     endpoint: 'activities/search',
   *     method: 'POST',
   *     queryParam: 'q'
   *   },
   *   filters: { theme_id: { type: 'relation' }, duration_minutes: { type: 'integer_range' } },
   *   lookup: { fields: ['title', 'description'] }
   * }
   * // → POST /activities/search { q: "Haskell", theme_id: 1, page: 1, per_page: 20 }
   *
   * @example Path 2 — Group search (delegates to shared catalogue endpoint)
   * static search = {
   *   query: { group: 'catalogue', modelName: ['episode', 'feature'] },
   *   lookup: { fields: ['external_id', 'external_id_type'] }
   * }
   * // → POST /catalogue/search { q: "drama", models: ['episode', 'feature'], page: 1, per_page: 20 }
   *
   * @example Path 3 — List fallback (no query config, only lookup fields)
   * static search = { lookup: { fields: ['name'] } }
   * // → GET /platforms?name=Netflix&page=1&per_page=20
   */
  async search(
    ModelClass: SearchModelClass,
    query: string,
    {
      page = 1,
      perPage = 20,
      filters
    }: { page?: number; perPage?: number; filters?: Record<string, unknown> } = {}
  ): Promise<SearchResult> {
    const queryConfig = ModelClass.search?.query

    if (!queryConfig) {
      // Fallback: field-based search on first lookup field
      const searchField = ModelClass.search?.lookup?.fields?.[0]
      if (searchField && query) {
        return this.list(ModelClass, { page, perPage, [searchField]: query })
      }
      return this.list(ModelClass, { page, perPage })
    }

    // Direct search endpoint
    if (queryConfig.endpoint) {
      return this._directSearch(ModelClass, query, { page, perPage, filters })
    }

    // Group search filtered to this model type
    if (queryConfig.group) {
      const groupName = queryConfig.group
      const modelName = queryConfig.modelName ?? ModelClass.singularName
      const models = Array.isArray(modelName) ? modelName : [modelName!]
      const result = await this.groupSearch(groupName, query, {
        page,
        perPage,
        models,
        filters
      })
      return result
    }

    // Should not reach here, but fallback to list
    return this.list(ModelClass, { page, perPage })
  }

  /**
   * Typeahead/autocomplete lookup for finding records by name.
   *
   * Resolution chain:
   * 1. search.lookup.endpoint -> dedicated lookup endpoint (GET)
   * 2. search.query exists -> delegate to search() with text query
   * 3. Neither -> list() with first lookup field as query param filter
   *
   * @example Path 1 — Dedicated lookup endpoint
   * static search = {
   *   query: { group: 'catalogue' },
   *   lookup: { endpoint: 'brands/autocomplete', fields: ['external_id', 'external_id_type'] }
   * }
   * // → GET /brands/autocomplete?external_id=BBC&per_page=10
   *
   * @example Path 2 — Falls through to search()
   * static search = {
   *   query: { endpoint: 'activities/search', method: 'POST', queryParam: 'q' },
   *   lookup: { fields: ['title', 'description'] }
   * }
   * // → POST /activities/search { q: "Haskell", page: 1, per_page: 10 }
   *
   * @example Path 3 — List fallback (no query config, no lookup endpoint)
   * static search = { lookup: { fields: ['external_id', 'name'] } }
   * // → GET /platforms?external_id=BBC&per_page=10
   */
  async lookup(
    ModelClass: SearchModelClass,
    query: string,
    { perPage = 10 }: { perPage?: number } = {}
  ): Promise<SearchResult> {
    const lookupConfig = ModelClass.search?.lookup
    const queryConfig = ModelClass.search?.query

    // 1. Dedicated lookup endpoint
    if (lookupConfig?.endpoint) {
      const paramName = lookupConfig.queryParam || lookupConfig.fields?.[0] || 'q'
      const params: Record<string, unknown> = { per_page: perPage }
      if (query) params[paramName] = query
      const data = await this._apiClient.get(lookupConfig.endpoint, params)
      return this._normalizeResponse(data, { page: 1, perPage })
    }

    // 2. Delegate to structured search
    if (queryConfig) {
      return this.search(ModelClass, query, { perPage })
    }

    // 3. List fallback with first lookup field
    const searchField = lookupConfig?.fields?.[0]
    if (searchField && query) {
      return this.list(ModelClass, { perPage, [searchField]: query })
    }
    return this.list(ModelClass, { perPage })
  }

  /** Multi-model search across a named group. */
  async groupSearch(
    groupName: string,
    query: string,
    {
      page = 1,
      perPage = 20,
      models,
      filters
    }: {
      page?: number
      perPage?: number
      models?: string[]
      filters?: Record<string, unknown>
    } = {}
  ): Promise<SearchResult> {
    const group = this._searchGroups[groupName]
    if (!group) {
      throw new Error(
        `Unknown search group: "${groupName}". Available: ${Object.keys(this._searchGroups).join(', ') || 'none'}`
      )
    }

    const adapter = group.adapter || this._defaultAdapter
    const body = adapter.buildBody(query, filters, { page, perPage }, {
      query: group
    } as SearchConfig)

    // Model scoping is separate from filters -- stays at top level
    if (models && models.length > 0) {
      body[group.modelsParam] = models
    }

    const response = await this._apiClient.post(group.endpoint, body)
    return this._normalizeResponse(response, { page, perPage })
  }

  /**
   * Paginated listing (always available -- uses GET Model.endpoint).
   *
   * Always available regardless of search config.
   *
   * @example
   * searchClient.list(BookModel, { page: 2, perPage: 50 })
   * // → GET /books?page=2&per_page=50
   *
   * searchClient.list(BookModel, { status: 'reading', sort: 'title' })
   * // → GET /books?page=1&per_page=20&status=reading&sort=title
   */
  async list(
    ModelClass: SearchModelClass,
    {
      page = 1,
      perPage = 20,
      sort,
      ...fieldFilters
    }: { page?: number; perPage?: number; sort?: string; [key: string]: unknown } = {}
  ): Promise<SearchResult> {
    const params: Record<string, unknown> = { page, per_page: perPage, ...fieldFilters }
    if (sort) params.sort = sort

    const data = await this._apiClient.get(ModelClass.api.endpoint, params)

    const convention = ModelClass.api?.convention ?? defaultConvention
    return convention.normalizeListResponse(data, { page, perPage }) as SearchResult
  }

  /** Get the search capability of a model. */
  static getSearchCapability(ModelClass: SearchModelClass): 'direct' | 'group' | 'list-only' {
    const queryConfig = ModelClass.search?.query
    if (!queryConfig) return 'list-only'
    if (queryConfig.endpoint) return 'direct'
    if (queryConfig.group) return 'group'
    return 'list-only'
  }

  /** Get the lookup capability of a model. */
  static getLookupCapability(
    ModelClass: SearchModelClass
  ): 'dedicated' | 'search-fallback' | 'list-fallback' {
    if (ModelClass.search?.lookup?.endpoint) return 'dedicated'
    if (ModelClass.search?.query) return 'search-fallback'
    return 'list-fallback'
  }

  /** Get the search group name for a model, if any. */
  static getSearchGroup(ModelClass: SearchModelClass): string | null {
    return ModelClass.search?.query?.group || null
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /** Execute a direct search against a model's own search endpoint. */
  private async _directSearch(
    ModelClass: SearchModelClass,
    query: string,
    {
      page,
      perPage,
      filters
    }: { page: number; perPage: number; filters?: Record<string, unknown> } = {
      page: 1,
      perPage: 20
    }
  ): Promise<SearchResult> {
    const queryConfig = ModelClass.search?.query
    const method = (queryConfig!.method || 'POST').toUpperCase()

    if (method === 'POST') {
      const adapter = (queryConfig!.adapter as SearchAdapter) || this._defaultAdapter
      const { body, queryParams } = adapter.buildRequest(
        query,
        filters,
        { page, perPage },
        ModelClass.search as SearchConfig
      )

      const endpoint = queryParams
        ? `${queryConfig!.endpoint}?${queryParams}`
        : queryConfig!.endpoint!
      const response = await this._apiClient.post(endpoint, body)
      return this._normalizeResponse(response, { page, perPage })
    }

    // GET request
    const params: Record<string, unknown> = {
      [queryConfig!.queryParam!]: query,
      page,
      per_page: perPage
    }

    const data = await this._apiClient.get(queryConfig!.endpoint!, params)
    return this._normalizeResponse(data, { page, perPage })
  }

  /** Normalize API response into { records, pagination } shape. */
  private _normalizeResponse(
    response: Record<string, unknown>,
    { page, perPage }: { page: number; perPage: number }
  ): SearchResult {
    const records = this._extractRecords(response)
    const pagination = this._extractPagination(response, records, { page, perPage })
    return { records, pagination }
  }

  /** Extract records array from various API response formats. */
  private _extractRecords(response: Record<string, unknown>): Record<string, unknown>[] {
    if (Array.isArray(response)) return response
    if (response.records) return response.records as Record<string, unknown>[]
    if (response.data) return response.data as Record<string, unknown>[]

    // HAL format: _embedded.{key} where key is the first array value
    if (response._embedded) {
      const embedded = response._embedded as Record<string, unknown>
      const embeddedKey = Object.keys(embedded).find((k) => Array.isArray(embedded[k]))
      if (embeddedKey) return embedded[embeddedKey] as Record<string, unknown>[]
    }

    // Model-keyed top-level array (e.g., response.schedulings)
    const arrayKey = Object.keys(response).find((k) => Array.isArray(response[k]) && k !== '_links')
    if (arrayKey) return response[arrayKey] as Record<string, unknown>[]

    return []
  }

  /** Extract pagination from various API response formats. */
  private _extractPagination(
    response: Record<string, unknown>,
    records: Record<string, unknown>[],
    { page, perPage }: { page: number; perPage: number }
  ): PaginationInfo {
    if (response.pagination) return response.pagination as PaginationInfo
    if (response.meta) return response.meta as PaginationInfo

    return {
      page: (response.page as number) || page,
      per_page: (response.per_page as number) || perPage,
      total: (response.total_count ??
        response.total_entries ??
        response.total ??
        records.length) as number,
      total_pages: response.total_pages as number | undefined
    }
  }
}
