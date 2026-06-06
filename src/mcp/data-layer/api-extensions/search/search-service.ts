/**
 * SearchService -- Normalized search interface for MCP apps and tools.
 *
 * Backed by a `DataLayer` so search composes with any adapter the
 * projection layer is wired to. The service issues raw HTTP via
 * `DataLayer.dispatch` and never reaches for a concrete `ApiClient`.
 *
 *   MCP App/Tool -> SearchService -> DataLayer.dispatch -> API
 *
 * Three entry points:
 * - search()  — structured query with filters (POST or group-based)
 * - lookup()  — typeahead/autocomplete for finding records by name
 * - list()    — paginated GET listing (always available)
 *
 * For both direct and group search endpoints, the request body is built by a
 * SearchRequestShaper. The adapter can be set at three levels (highest priority first):
 * 1. Per-model: `search.query.adapter`
 * 2. Per-group: `searchGroup.adapter`
 * 3. Server-wide: `defaultShaper` in the SearchService constructor
 *
 * The base SearchRequestShaper spreads filters flat into the body. For Rails-style
 * nesting (e.g., `{ filters: { ... } }`), use RailsSearchRequestShaper.
 *
 * CRUD operations remain on the typed `DataLayer.find/list/create/update`
 * surface; SearchService only handles the search-specific dispatch paths.
 */

import { defaultConvention } from '#src/mcp/data-layer/api-conventions/index.js'
import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'

import { getSearchConfig } from './capabilities.js'
import { SearchRequestShaper } from './request-shapers/default.js'
import type {
  PaginationInfo,
  SearchConfig,
  SearchGroup,
  SearchModelClass,
  SearchResult
} from './types.js'

export class SearchService {
  private _dataLayer: DataLayer
  private _searchGroups: Record<string, SearchGroup>
  private _defaultShaper: SearchRequestShaper

  constructor(
    dataLayer: DataLayer,
    {
      searchGroups = {},
      defaultShaper = new SearchRequestShaper()
    }: {
      searchGroups?: Record<string, SearchGroup>
      defaultShaper?: SearchRequestShaper
    } = {}
  ) {
    this._dataLayer = dataLayer
    this._searchGroups = searchGroups
    this._defaultShaper = defaultShaper
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
    const searchCfg = getSearchConfig(ModelClass)
    const queryConfig = searchCfg?.query

    if (!queryConfig) {
      // Fallback: field-based search on first lookup field
      const searchField = searchCfg?.lookup?.fields?.[0]
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
    const searchCfg = getSearchConfig(ModelClass)
    const lookupConfig = searchCfg?.lookup
    const queryConfig = searchCfg?.query

    // 1. Dedicated lookup endpoint
    if (lookupConfig?.endpoint) {
      const paramName = lookupConfig.queryParam || lookupConfig.fields?.[0] || 'q'
      const params: Record<string, unknown> = { per_page: perPage }
      if (query) params[paramName] = query
      const data = await this._dataLayer.dispatch('GET', lookupConfig.endpoint, undefined, params)
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

    const adapter = group.shaper || this._defaultShaper
    const body = adapter.buildBody(query, filters, { page, perPage }, {
      query: group
    } as SearchConfig)

    // Model scoping is separate from filters -- stays at top level
    if (models && models.length > 0) {
      body[group.modelsParam] = models
    }

    const response = await this._dataLayer.dispatch('POST', group.endpoint, body)
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

    const data = await this._dataLayer.dispatch('GET', ModelClass.api.endpoint, undefined, params)

    const convention = ModelClass.api?.convention ?? defaultConvention
    return convention.normalizeListResponse(data, { page, perPage }) as SearchResult
  }

  /** Get the search capability of a model. */
  static getSearchCapability(ModelClass: SearchModelClass): 'direct' | 'group' | 'list-only' {
    const queryConfig = getSearchConfig(ModelClass)?.query
    if (!queryConfig) return 'list-only'
    if (queryConfig.endpoint) return 'direct'
    if (queryConfig.group) return 'group'
    return 'list-only'
  }

  /** Get the lookup capability of a model. */
  static getLookupCapability(
    ModelClass: SearchModelClass
  ): 'dedicated' | 'search-fallback' | 'list-fallback' {
    const searchCfg = getSearchConfig(ModelClass)
    if (searchCfg?.lookup?.endpoint) return 'dedicated'
    if (searchCfg?.query) return 'search-fallback'
    return 'list-fallback'
  }

  /** Get the search group name for a model, if any. */
  static getSearchGroup(ModelClass: SearchModelClass): string | null {
    return getSearchConfig(ModelClass)?.query?.group || null
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
    const searchCfg = getSearchConfig(ModelClass)
    const queryConfig = searchCfg?.query
    const method = (queryConfig!.method || 'POST').toUpperCase()

    if (method === 'POST') {
      const adapter = (queryConfig!.shaper as SearchRequestShaper) || this._defaultShaper
      const { body, queryParams } = adapter.buildRequest(
        query,
        filters,
        { page, perPage },
        searchCfg as SearchConfig
      )

      const endpoint = queryParams
        ? `${queryConfig!.endpoint}?${queryParams}`
        : queryConfig!.endpoint!
      const response = await this._dataLayer.dispatch('POST', endpoint, body)
      return this._normalizeResponse(response, { page, perPage })
    }

    // GET request
    const params: Record<string, unknown> = {
      [queryConfig!.queryParam!]: query,
      page,
      per_page: perPage
    }

    const data = await this._dataLayer.dispatch('GET', queryConfig!.endpoint!, undefined, params)
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
