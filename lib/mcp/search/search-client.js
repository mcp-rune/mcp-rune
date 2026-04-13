/**
 * SearchClient — Normalized search interface for MCP apps and tools.
 *
 * Wraps apiClient to provide a consistent search API regardless of
 * whether a model has its own search endpoint, delegates to a group
 * search endpoint, or only supports listing.
 *
 *   MCP App/Tool → SearchClient → apiClient → Rails API
 *
 * For both direct and group search endpoints, the request body is built by a
 * SearchAdapter. Models can declare a custom adapter (e.g., ActivitySearchAdapter)
 * in their `search.fullText.adapter` config, and groups can declare one in
 * their search group config. When no adapter is declared, the default
 * SearchAdapter passes filters through unchanged.
 *
 * CRUD operations still use apiClient directly via Model.endpoint.
 */

import { SearchAdapter } from './search-adapter.js'
import { defaultConvention } from '../api-conventions/index.js'

const defaultAdapter = new SearchAdapter()

export class SearchClient {
  /**
   * @param {Object} apiClient - API client with get/post methods
   * @param {Object} [options]
   * @param {Object} [options.searchGroups] - Search group definitions keyed by group name
   */
  constructor(apiClient, { searchGroups = {} } = {}) {
    this._apiClient = apiClient
    this._searchGroups = searchGroups
  }

  /**
   * Full-text search for a single model.
   *
   * Resolution order:
   * 1. model.search.endpoint → direct endpoint (POST or GET)
   * 2. model.search.group → group search filtered to this model type
   *    Uses fullText.modelName if set, otherwise falls back to singularName.
   *    modelName can be a string or array (e.g., ['episode', 'feature']).
   * 3. Neither → field-based search on first searchable field via list()
   *
   * @param {Function} ModelClass - Model class with static search config
   * @param {string} query - Search query text
   * @param {Object} [options]
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.perPage=20] - Results per page
   * @param {Object} [options.filters] - Additional filters (direct + group search)
   * @returns {Promise<{ records: Object[], pagination: Object }>}
   */
  async search(ModelClass, query, { page = 1, perPage = 20, filters } = {}) {
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
      const models = Array.isArray(modelName) ? modelName : [modelName]
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
   * Multi-model search across a named group.
   *
   * @param {string} groupName - Search group name (e.g., 'library')
   * @param {string} query - Search query text
   * @param {Object} [options]
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.perPage=20] - Results per page
   * @param {string[]} [options.models] - Subset of group models to search (default: all)
   * @param {Object} [options.filters] - Additional filters (nested under filtersParam)
   * @returns {Promise<{ records: Object[], pagination: Object }>}
   */
  async groupSearch(groupName, query, { page = 1, perPage = 20, models, filters } = {}) {
    const group = this._searchGroups[groupName]
    if (!group) {
      throw new Error(
        `Unknown search group: "${groupName}". Available: ${Object.keys(this._searchGroups).join(', ') || 'none'}`
      )
    }

    const adapter = group.adapter || defaultAdapter
    const body = adapter.buildBody(query, filters, { page, perPage }, { fullText: group })

    // Model scoping is separate from filters — stays at top level
    if (models && models.length > 0) {
      body[group.modelsParam] = models
    }

    const response = await this._apiClient.post(group.endpoint, body)
    return this._normalizeResponse(response, { page, perPage })
  }

  /**
   * Paginated listing (always available — uses GET Model.endpoint).
   *
   * @param {Function} ModelClass - Model class
   * @param {Object} [options]
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.perPage=20] - Results per page
   * @param {string} [options.sort] - Sort field
   * @param {...*} [options.fieldFilters] - Additional field-level filters
   * @returns {Promise<{ records: Object[], pagination: Object }>}
   */
  async list(ModelClass, { page = 1, perPage = 20, sort, ...fieldFilters } = {}) {
    const params = { page, per_page: perPage, ...fieldFilters }
    if (sort) params.sort = sort

    const data = await this._apiClient.get(ModelClass.endpoint, params)

    const convention = ModelClass.api?.convention ?? defaultConvention
    return convention.normalizeListResponse(data, { page, perPage })
  }

  /**
   * Get the search capability of a model.
   *
   * @param {Function} ModelClass - Model class
   * @returns {'direct' | 'group' | 'list-only'}
   */
  static getSearchCapability(ModelClass) {
    const fullText = ModelClass.search?.fullText
    if (!fullText) return 'list-only'
    if (fullText.endpoint) return 'direct'
    if (fullText.group) return 'group'
    return 'list-only'
  }

  /**
   * Get the search group name for a model, if any.
   *
   * @param {Function} ModelClass - Model class
   * @returns {string|null}
   */
  static getSearchGroup(ModelClass) {
    return ModelClass.search?.fullText?.group || null
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Execute a direct search against a model's own search endpoint.
   * @private
   */
  async _directSearch(ModelClass, query, { page, perPage, filters } = {}) {
    const fullText = ModelClass.search?.fullText
    const method = (fullText.method || 'POST').toUpperCase()

    if (method === 'POST') {
      const adapter = fullText.adapter || defaultAdapter
      const { body, queryParams } = adapter.buildRequest(
        query,
        filters,
        { page, perPage },
        ModelClass.search
      )

      const endpoint = queryParams ? `${fullText.endpoint}?${queryParams}` : fullText.endpoint
      const response = await this._apiClient.post(endpoint, body)
      return this._normalizeResponse(response, { page, perPage })
    }

    // GET request
    const params = {
      [fullText.queryParam]: query,
      page,
      per_page: perPage
    }

    const data = await this._apiClient.get(fullText.endpoint, params)
    return this._normalizeResponse(data, { page, perPage })
  }

  /**
   * Normalize API response into { records, pagination } shape.
   * @private
   */
  _normalizeResponse(response, { page, perPage }) {
    const records = this._extractRecords(response)
    const pagination = this._extractPagination(response, records, { page, perPage })
    return { records, pagination }
  }

  /**
   * Extract records array from various API response formats.
   * @private
   */
  _extractRecords(response) {
    if (Array.isArray(response)) return response
    if (response.records) return response.records
    if (response.data) return response.data

    // HAL format: _embedded.{key} where key is the first array value
    if (response._embedded) {
      const embeddedKey = Object.keys(response._embedded).find((k) =>
        Array.isArray(response._embedded[k])
      )
      if (embeddedKey) return response._embedded[embeddedKey]
    }

    // Model-keyed top-level array (e.g., response.schedulings)
    const arrayKey = Object.keys(response).find((k) => Array.isArray(response[k]) && k !== '_links')
    if (arrayKey) return response[arrayKey]

    return []
  }

  /**
   * Extract pagination from various API response formats.
   * @private
   */
  _extractPagination(response, records, { page, perPage }) {
    if (response.pagination) return response.pagination
    if (response.meta) return response.meta

    return {
      page: response.page || page,
      per_page: response.per_page || perPage,
      total: response.total_count ?? response.total_entries ?? response.total ?? records.length,
      total_pages: response.total_pages
    }
  }
}
