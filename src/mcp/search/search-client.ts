/**
 * SearchClient -- Normalized search interface for MCP apps and tools.
 *
 * Wraps apiClient to provide a consistent search API regardless of
 * whether a model has its own search endpoint, delegates to a group
 * search endpoint, or only supports listing.
 *
 *   MCP App/Tool -> SearchClient -> apiClient -> Rails API
 *
 * For both direct and group search endpoints, the request body is built by a
 * SearchAdapter. Models can declare a custom adapter (e.g., ActivitySearchAdapter)
 * in their `search.fullText.adapter` config, and groups can declare one in
 * their search group config. When no adapter is declared, the default
 * SearchAdapter passes filters through unchanged.
 *
 * CRUD operations still use apiClient directly via Model.endpoint.
 */

import { defaultConvention } from '../api-conventions/index.js'
import type { SearchConfig } from './search-adapter.js'
import { SearchAdapter } from './search-adapter.js'

const defaultAdapter = new SearchAdapter()

export interface ApiClient {
  get(endpoint: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  post(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>>
}

export interface FullTextSearchConfig {
  endpoint?: string
  group?: string
  method?: string
  queryParam?: string
  filtersParam?: string
  adapter?: SearchAdapter
  modelName?: string | string[]
  expand?: string[]
  [key: string]: unknown
}

export interface SearchModelClass {
  endpoint: string
  singularName?: string
  search?: {
    fullText?: FullTextSearchConfig
    autocompleteFields?: string[]
    filters?: Record<string, unknown>
    [key: string]: unknown
  }
  api?: {
    convention?: typeof defaultConvention
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
  filtersParam?: string
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

export class SearchClient {
  private _apiClient: ApiClient
  private _searchGroups: Record<string, SearchGroup>

  constructor(
    apiClient: ApiClient,
    { searchGroups = {} }: { searchGroups?: Record<string, SearchGroup> } = {}
  ) {
    this._apiClient = apiClient
    this._searchGroups = searchGroups
  }

  /**
   * Full-text search for a single model.
   *
   * Resolution order:
   * 1. model.search.endpoint -> direct endpoint (POST or GET)
   * 2. model.search.group -> group search filtered to this model type
   *    Uses fullText.modelName if set, otherwise falls back to singularName.
   *    modelName can be a string or array (e.g., ['episode', 'feature']).
   * 3. Neither -> field-based search on first searchable field via list()
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
    const fullText = ModelClass.search?.fullText

    if (!fullText) {
      // Fallback: field-based search on first autocomplete field
      const searchField = ModelClass.search?.autocompleteFields?.[0]
      if (searchField && query) {
        return this.list(ModelClass, { page, perPage, [searchField]: query })
      }
      return this.list(ModelClass, { page, perPage })
    }

    // Direct search endpoint
    if (fullText.endpoint) {
      return this._directSearch(ModelClass, query, { page, perPage, filters })
    }

    // Group search filtered to this model type
    if (fullText.group) {
      const groupName = fullText.group
      const modelName = fullText.modelName ?? ModelClass.singularName
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

    const adapter = group.adapter || defaultAdapter
    const body = adapter.buildBody(query, filters, { page, perPage }, {
      fullText: group
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

    const data = await this._apiClient.get(ModelClass.endpoint, params)

    const convention = ModelClass.api?.convention ?? defaultConvention
    return convention.normalizeListResponse(data, { page, perPage }) as SearchResult
  }

  /** Get the search capability of a model. */
  static getSearchCapability(ModelClass: SearchModelClass): 'direct' | 'group' | 'list-only' {
    const fullText = ModelClass.search?.fullText
    if (!fullText) return 'list-only'
    if (fullText.endpoint) return 'direct'
    if (fullText.group) return 'group'
    return 'list-only'
  }

  /** Get the search group name for a model, if any. */
  static getSearchGroup(ModelClass: SearchModelClass): string | null {
    return ModelClass.search?.fullText?.group || null
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
    const fullText = ModelClass.search?.fullText
    const method = (fullText!.method || 'POST').toUpperCase()

    if (method === 'POST') {
      const adapter = fullText!.adapter || defaultAdapter
      const { body, queryParams } = adapter.buildRequest(
        query,
        filters,
        { page, perPage },
        ModelClass.search as SearchConfig
      )

      const endpoint = queryParams ? `${fullText!.endpoint}?${queryParams}` : fullText!.endpoint!
      const response = await this._apiClient.post(endpoint, body)
      return this._normalizeResponse(response, { page, perPage })
    }

    // GET request
    const params: Record<string, unknown> = {
      [fullText!.queryParam!]: query,
      page,
      per_page: perPage
    }

    const data = await this._apiClient.get(fullText!.endpoint!, params)
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
