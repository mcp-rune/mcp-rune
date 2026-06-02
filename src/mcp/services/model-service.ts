/**
 * ModelService — Service layer for model CRUD operations.
 *
 * Composes EndpointResolver + Convention + ApiClient to provide a clean
 * interface for data operations. Tools delegate here instead of directly
 * resolving endpoints and building payloads.
 *
 * Design constraints (to prevent over-abstraction):
 * - Returns raw API responses — no MCP formatting
 * - Throws domain errors — tools catch and format for MCP
 * - Has no knowledge of MCP protocol (no ToolResult, no content arrays)
 * - Does NOT absorb vector storage, usage rules, or schema derivation
 */

import type { NormalizedListResponse } from '#src/api-extensions/search/types.js'
import type { ApiClient, RequestOptions } from '#src/core/api-client.js'
import type { DataLayer } from '#src/core/data-layer.js'

import type { AssociationConfig, BaseConvention } from '../api-conventions/base-convention.js'
import { defaultConvention } from '../api-conventions/index.js'
import type { ModelConfig, ModelsRegistry, ToolLogger } from '../tools/base-tool.js'
import type { CrudAction, EndpointResolverConfig } from './endpoint-resolver.js'
import { EndpointResolver, MissingParentError } from './endpoint-resolver.js'

// ============================================================================
// Types
// ============================================================================

/** Dependencies injected into ModelService. */
export interface ModelServiceConfig {
  apiClient: ApiClient
  models: ModelsRegistry
  /** Server-wide namespace for endpoint resolution. */
  namespace?: string
  /** Custom endpoint resolver (optional — uses default if omitted). */
  endpointResolver?: EndpointResolver
  logger?: ToolLogger
}

/** Pagination parameters. */
export interface PaginationParams {
  page?: number
  perPage?: number
}

/** Extended request options with parent path for nested operations. */
export interface ModelRequestOptions extends RequestOptions {
  /** Parent path for nested resource operations (e.g., 'titles/42/assets'). */
  parentPath?: string
}

// ============================================================================
// Errors
// ============================================================================

/** Thrown when attempting a write operation on a read-only model. */
export class ModelReadOnlyError extends Error {
  constructor(model: string, description?: string) {
    const desc = description ? `${description} ` : ''
    super(
      `The '${model}' model is read-only and cannot be modified. ` +
        `${desc}Use find_records to look up existing records.`
    )
    this.name = 'ModelReadOnlyError'
  }
}

/** Thrown when required fields are missing for a create operation. */
export class MissingRequiredFieldsError extends Error {
  readonly missingFields: string[]

  constructor(missingFields: string[]) {
    super(`Missing required fields: ${missingFields.join(', ')}`)
    this.name = 'MissingRequiredFieldsError'
    this.missingFields = missingFields
  }
}

/** Thrown when a model name is not found in the registry. */
export class UnknownModelError extends Error {
  readonly availableModels: string[]

  constructor(model: string, availableModels: string[]) {
    super(`Unknown model: ${model}. Available models: ${availableModels.join(', ')}`)
    this.name = 'UnknownModelError'
    this.availableModels = availableModels
  }
}

// ============================================================================
// ModelService
// ============================================================================

export class ModelService implements DataLayer {
  private _apiClient: ApiClient
  private _models: ModelsRegistry
  private _resolver: EndpointResolver
  private _logger?: ToolLogger

  constructor(config: ModelServiceConfig) {
    this._apiClient = config.apiClient
    this._models = config.models
    this._logger = config.logger
    this._resolver =
      config.endpointResolver ??
      new EndpointResolver(
        config.namespace ? ({ namespace: config.namespace } as EndpointResolverConfig) : undefined
      )
  }

  // --- Public API ---

  /** Create a record. Validates required fields, resolves endpoint, builds convention payload. */
  async create(
    model: string,
    attributes: Record<string, unknown>,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateWritable(model)

    // Validate required fields
    const requiredFields = ((modelConfig as Record<string, unknown>).required as string[]) ?? []
    const missingFields = requiredFields.filter((field: string) => attributes[field] === undefined)
    if (missingFields.length > 0) {
      throw new MissingRequiredFieldsError(missingFields)
    }

    let endpoint: string
    try {
      endpoint = this._resolver.resolveCollection(
        { model, modelConfig, attributes, parentPath: options?.parentPath },
        'create' as CrudAction
      )
    } catch (error) {
      throw error instanceof MissingParentError ? this._enrichMissingParentError(error) : error
    }
    const payload = this.buildPayload(model, modelConfig, attributes)

    this._log('info', 'Creating model', { model, impersonating: options?.userId ?? null })
    const data =
      options !== undefined
        ? await this._apiClient.post(endpoint, payload, options)
        : await this._apiClient.post(endpoint, payload)
    this._log('info', 'Model created successfully', {
      model,
      id: (data as Record<string, unknown>).id
    })

    return data
  }

  /** Find a record by ID. Supports compound IDs for nested resources. */
  async find(
    model: string,
    recordId: string,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateModel(model)
    const endpoint = this._resolver.resolveRecord(
      { model, modelConfig, recordId },
      'find' as CrudAction
    )

    this._log('info', 'Finding model', { model, recordId, impersonating: options?.userId ?? null })
    return options !== undefined
      ? await this._apiClient.get(endpoint, {}, options)
      : await this._apiClient.get(endpoint, {})
  }

  /** List records with optional filters and pagination. Supports parentPath for nested resources. */
  async list(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateModel(model)
    let endpoint: string
    try {
      endpoint = this._resolver.resolveCollection(
        { model, modelConfig, parentPath: options?.parentPath },
        'list' as CrudAction
      )
    } catch (error) {
      throw error instanceof MissingParentError ? this._enrichMissingParentError(error) : error
    }

    const queryParams = {
      ...filters,
      page: pagination?.page ?? 1,
      per_page: pagination?.perPage ?? 20
    }

    this._log('info', 'Listing models', { model, impersonating: options?.userId ?? null })
    // Trim trailing `undefined` so third-party API clients see the same call
    // shape they'd get from a direct caller. Same treatment v0.49.1 applied
    // to `dispatch`; surfaced after v0.50 routed apps through `list()` via
    // `listNormalized`.
    return options !== undefined
      ? await this._apiClient.get(endpoint, queryParams, options)
      : await this._apiClient.get(endpoint, queryParams)
  }

  /**
   * List records and return a convention-normalized `{ records, pagination }`
   * envelope. Composes `list()` with the model's `BaseConvention` so callers
   * (notably MCP apps) never need to import `defaultConvention` themselves.
   */
  async listNormalized(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse> {
    const modelConfig = this._validateModel(model)
    const data = await this.list(model, filters, pagination, options)
    const convention = this._getConvention(modelConfig)
    return convention.normalizeListResponse(data, {
      page: pagination?.page ?? 1,
      perPage: pagination?.perPage ?? 20
    })
  }

  /**
   * Plain `ModelService` cannot resolve a model's search-endpoint routing
   * on its own — text search lives in the `search` ApiExtension. This
   * default falls back to `listNormalized`, ignoring `query`. Integrators
   * that want text search wrap this adapter in `SearchEnabledDataLayer`
   * (see `src/api-extensions/search`).
   */
  async searchNormalized(
    model: string,
    _query?: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse> {
    return this.listNormalized(model, filters, pagination, options)
  }

  /**
   * Plain `ModelService` has no notion of lookup endpoints. Falls back to
   * `listNormalized` so the projection layer can still ask for typeahead
   * results without crashing — the result is a plain page rather than a
   * query-filtered set. Integrators that want real typeahead wrap this
   * adapter in `SearchEnabledDataLayer`.
   */
  async lookupNormalized(
    model: string,
    _query: string,
    options?: { perPage?: number }
  ): Promise<NormalizedListResponse> {
    return this.listNormalized(model, undefined, { page: 1, perPage: options?.perPage ?? 10 })
  }

  /**
   * Group search requires the search ApiExtension to be wired (it owns
   * the `searchGroups` config). Plain `ModelService` throws a clear
   * error so callers know they need `SearchEnabledDataLayer` for this
   * capability.
   */
  async groupSearchNormalized(
    _group: string,
    _query: string,
    _options?: { perPage?: number; models?: string[] }
  ): Promise<NormalizedListResponse> {
    throw new Error(
      'Group search requires the search ApiExtension. Wrap this adapter in SearchEnabledDataLayer ' +
        '(see src/api-extensions/search/search-enabled-data-layer.ts).'
    )
  }

  /** Update a record (partial attributes). Supports compound IDs. */
  async update(
    model: string,
    recordId: string,
    attributes: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateWritable(model)
    const endpoint = this._resolver.resolveRecord(
      { model, modelConfig, recordId },
      'update' as CrudAction
    )
    const payload = this.buildPayload(model, modelConfig, attributes)

    this._log('info', 'Updating model', {
      model,
      recordId,
      impersonating: options?.userId ?? null
    })
    const data =
      options !== undefined
        ? await this._apiClient.patch(endpoint, payload, options)
        : await this._apiClient.patch(endpoint, payload)
    this._log('info', 'Model updated successfully', { model, recordId })

    return data
  }

  /** Delete a record. Supports compound IDs. */
  async delete(
    model: string,
    recordId: string,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateWritable(model)
    const endpoint = this._resolver.resolveRecord(
      { model, modelConfig, recordId },
      'delete' as CrudAction
    )

    this._log('info', 'Deleting model', {
      model,
      recordId,
      impersonating: options?.userId ?? null
    })
    return options !== undefined
      ? await this._apiClient.delete(endpoint, options)
      : await this._apiClient.delete(endpoint)
  }

  // --- Accessors ---

  /** Access the underlying endpoint resolver (for advanced use cases). */
  get endpointResolver(): EndpointResolver {
    return this._resolver
  }

  /** Access the underlying API client. */
  get apiClient(): ApiClient {
    return this._apiClient
  }

  /**
   * Read-only view of the models registry the service was constructed with.
   * Part of the `ApiExtension` mixin contract.
   */
  get models(): ModelsRegistry {
    return this._models
  }

  // --- Extension contract (stable; ApiExtension mixins compose these) ---

  /**
   * Dispatch an HTTP request to the appropriate ApiClient method.
   *
   * Public so ApiExtension mixins can reuse it for non-CRUD verbs without
   * touching the underlying ApiClient directly.
   */
  async dispatch(
    method: string,
    url: string,
    payload?: Record<string, unknown>,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    // Omit trailing `undefined` args when the caller passed nothing; the
    // underlying ApiClient sees the same call shape it would receive from a
    // direct caller, which keeps third-party clients (and their tests) free
    // of spurious `undefined` trailing args.
    switch (method) {
      case 'GET':
        if (options !== undefined) return this._apiClient.get(url, params, options)
        if (params !== undefined) return this._apiClient.get(url, params)
        return this._apiClient.get(url)
      case 'POST':
        if (options !== undefined) return this._apiClient.post(url, payload, options)
        if (payload !== undefined) return this._apiClient.post(url, payload)
        return this._apiClient.post(url)
      case 'PUT':
        if (options !== undefined) return this._apiClient.put(url, payload, options)
        if (payload !== undefined) return this._apiClient.put(url, payload)
        return this._apiClient.put(url)
      case 'PATCH':
        if (options !== undefined) return this._apiClient.patch(url, payload, options)
        if (payload !== undefined) return this._apiClient.patch(url, payload)
        return this._apiClient.patch(url)
      case 'DELETE':
        if (options !== undefined) return this._apiClient.delete(url, options)
        return this._apiClient.delete(url)
      default:
        throw new Error(`Unsupported HTTP method: ${method}`)
    }
  }

  /**
   * Build a request payload through the model's convention.
   *
   * Public so ApiExtension mixins can reuse the convention pipeline
   * (association resolution + body wrapping) instead of bypassing it.
   */
  buildPayload(
    model: string,
    modelConfig: ModelConfig,
    attrs: Record<string, unknown>
  ): Record<string, unknown> {
    const convention = this._getConvention(modelConfig)

    let finalAttrs = attrs
    const associations = modelConfig.associations as AssociationConfig | undefined
    if (associations?.belongsTo) {
      finalAttrs = convention.resolveAssociationValues(
        attrs,
        associations.belongsTo,
        this._apiClient.baseUrl
      )
    }

    return convention.buildRequestPayload(model, finalAttrs)
  }

  // --- Internal helpers ---

  /** Validate model exists and return its config. */
  private _validateModel(model: string): ModelConfig {
    const config = this._models[model]
    if (!config) {
      throw new UnknownModelError(model, Object.keys(this._models))
    }
    return config
  }

  /** Validate model exists and is writable. */
  private _validateWritable(model: string): ModelConfig {
    const config = this._validateModel(model)
    if (config.api?.readOnly) {
      throw new ModelReadOnlyError(model, config.description)
    }
    return config
  }

  /** Get the convention for a model. */
  private _getConvention(modelConfig: ModelConfig): BaseConvention {
    return modelConfig.api?.convention ?? defaultConvention
  }

  /**
   * Enrich a MissingParentError with concrete parent endpoint paths from the registry.
   * Replaces generic `'{parent_endpoint}/{id}/assets'` with `'titles/{id}/assets'`.
   */
  private _enrichMissingParentError(error: MissingParentError): MissingParentError {
    const parentEndpoints = error.parentModels
      .map((name) => this._models[name]?.api?.endpoint)
      .filter((ep): ep is string => !!ep)

    if (parentEndpoints.length === 0) return error

    const examples = parentEndpoints.map((ep) => `'${ep}/{id}/${error.childEndpoint}'`).join(' or ')

    const enriched = new Error(
      `'${error.model}' is nested-only — provide parent_path ` +
        `(e.g., ${examples}). ` +
        `Valid parents: ${error.parentModels.join(', ')}.`
    ) as MissingParentError
    enriched.name = 'MissingParentError'
    return enriched
  }

  /** Log with optional logger. */
  private _log(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (this._logger) {
      this._logger[level](message, { service: 'model-service', ...meta })
    }
  }
}

/**
 * Normalize a raw list response with an explicit convention. Used by callers
 * that dispatch to a custom endpoint (e.g. nested-association lookups) and so
 * cannot resolve the convention from a model name. Keeps `defaultConvention`
 * out of consumer code; pass `undefined` to fall back to the framework default.
 */
export function normalizeListWithConvention(
  rawData: Record<string, unknown>,
  convention: BaseConvention | undefined,
  pagination: { page?: number; perPage?: number } = {}
): NormalizedListResponse {
  const conv = convention ?? defaultConvention
  return conv.normalizeListResponse(rawData, {
    page: pagination.page ?? 1,
    perPage: pagination.perPage ?? 20
  })
}
