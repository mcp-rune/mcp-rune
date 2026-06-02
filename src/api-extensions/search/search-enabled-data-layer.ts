/**
 * SearchEnabledDataLayer — DataLayer decorator that implements
 * `searchNormalized` by delegating to a `SearchService`.
 *
 * The base `ModelService` adapter cannot perform text search on its own
 * (it has no notion of per-model search endpoints, group routing, or
 * adapters). This wrapper composes a `SearchService` and exposes its
 * routing behind the `DataLayer.searchNormalized` seam, so the projection
 * layer (apps, tools, prompts) never needs to import `SearchService`
 * directly.
 *
 *   AppRegistry / ToolRegistry
 *     -> SearchEnabledDataLayer(base, searchService)
 *     -> SearchService.search(...)  // text + filters + nested-only routing
 *     -> base.dispatch(...)         // raw HTTP via the underlying adapter
 *
 * Routing for `searchNormalized`:
 *   1. If the model declares `extensions.search.query` OR `query` is a
 *      non-empty string OR the model is `api.standalone === false`
 *      (nested-only), delegate to `SearchService.search`.
 *   2. Otherwise, delegate to `base.listNormalized` — plain pagination.
 *
 * Every non-search method proxies to the wrapped base adapter. The seam
 * stays intact: callers see one `DataLayer` instance regardless of
 * whether search is wired.
 */

import type { ApiClient, RequestOptions } from '#src/core/api-client.js'
import type {
  DataLayer,
  EndpointResolver,
  ModelConfig,
  ModelRequestOptions,
  ModelsRegistry,
  NormalizedListResponse,
  PaginationParams
} from '#src/core/data-layer.js'

import { getSearchConfig } from './capabilities.js'
import type { SearchService } from './search-service.js'
import type { SearchModelClass } from './types.js'

export class SearchEnabledDataLayer implements DataLayer {
  private _base: DataLayer
  private _searchService: SearchService

  constructor(base: DataLayer, searchService: SearchService) {
    this._base = base
    this._searchService = searchService
  }

  get models(): ModelsRegistry {
    return this._base.models
  }

  get endpointResolver(): EndpointResolver {
    return this._base.endpointResolver
  }

  /** Direct access to the wrapped adapter (for tests and inspection). */
  get base(): DataLayer {
    return this._base
  }

  create(
    model: string,
    attributes: Record<string, unknown>,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    return this._base.create(model, attributes, options)
  }

  find(
    model: string,
    recordId: string,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    return this._base.find(model, recordId, options)
  }

  list(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    return this._base.list(model, filters, pagination, options)
  }

  listNormalized(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse> {
    return this._base.listNormalized(model, filters, pagination, options)
  }

  update(
    model: string,
    recordId: string,
    attributes: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    return this._base.update(model, recordId, attributes, options)
  }

  delete(
    model: string,
    recordId: string,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    return this._base.delete(model, recordId, options)
  }

  dispatch(
    method: string,
    url: string,
    payload?: Record<string, unknown>,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    return this._base.dispatch(method, url, payload, params, options)
  }

  buildPayload(
    model: string,
    modelConfig: ModelConfig,
    attrs: Record<string, unknown>
  ): Record<string, unknown> {
    return this._base.buildPayload(model, modelConfig, attrs)
  }

  /**
   * Route text+filter search through `SearchService` when the model opts
   * into search (or is nested-only); else delegate to `listNormalized`.
   */
  async searchNormalized(
    model: string,
    query?: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse> {
    const modelConfig = this._base.models[model]
    if (!modelConfig) {
      return this._base.searchNormalized(model, query, filters, pagination, options)
    }

    const hasQuery = typeof query === 'string' && query.length > 0
    const hasQueryConfig = !!getSearchConfig(modelConfig as never)?.query
    const isNestedOnly =
      (modelConfig as { api?: { standalone?: boolean } }).api?.standalone === false

    if (hasQuery || hasQueryConfig || isNestedOnly) {
      const result = await this._searchService.search(
        modelConfig as unknown as SearchModelClass,
        query ?? '',
        {
          page: pagination?.page ?? 1,
          perPage: pagination?.perPage ?? 20,
          ...(filters && Object.keys(filters).length > 0 ? { filters } : {})
        }
      )
      return { records: result.records, pagination: result.pagination }
    }

    return this._base.listNormalized(model, filters, pagination, options)
  }

  /**
   * Route single-model typeahead through `SearchService.lookup`, which
   * handles the dedicated-endpoint / search-fallback / list-fallback
   * resolution chain internally. Falls back to the base adapter's
   * `lookupNormalized` if the model is unknown.
   */
  async lookupNormalized(
    model: string,
    query: string,
    options?: { perPage?: number }
  ): Promise<NormalizedListResponse> {
    const modelConfig = this._base.models[model]
    if (!modelConfig) {
      return this._base.lookupNormalized(model, query, options)
    }
    const result = await this._searchService.lookup(
      modelConfig as unknown as SearchModelClass,
      query,
      { perPage: options?.perPage ?? 10 }
    )
    return { records: result.records, pagination: result.pagination }
  }

  /**
   * Multi-model typeahead via `SearchService.groupSearch`. The group must
   * be configured in `searchGroups` at the registry; if not, the
   * underlying `SearchService` throws and the error surfaces back to the
   * caller (the app can render an error state).
   */
  async groupSearchNormalized(
    group: string,
    query: string,
    options?: { perPage?: number; models?: string[] }
  ): Promise<NormalizedListResponse> {
    const result = await this._searchService.groupSearch(group, query, {
      page: 1,
      perPage: options?.perPage ?? 20,
      ...(options?.models ? { models: options.models } : {})
    })
    return { records: result.records, pagination: result.pagination }
  }
}

/**
 * Convenience factory: given a base `DataLayer` and the same context bag
 * `createSearchService` consumes, return a `SearchEnabledDataLayer` ready
 * to drop into a registry context. Avoids forcing every wiring site to
 * import both `createSearchService` and `SearchEnabledDataLayer`.
 */
import { createSearchService } from './factory.js'

export function withSearchEnabledDataLayer(
  base: DataLayer,
  context?: Record<string, unknown>
): SearchEnabledDataLayer {
  const searchService = createSearchService(base, context)
  return new SearchEnabledDataLayer(base, searchService)
}

/** Re-export the unwrapped `ApiClient` type so consumers can import from one place. */
export type { ApiClient }
