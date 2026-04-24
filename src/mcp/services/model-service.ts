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

import type { ActionDefinition } from '../../core/base-model.js'
import type { AssociationConfig, BaseConvention } from '../api-conventions/base-convention.js'
import { defaultConvention } from '../api-conventions/index.js'
import type { ApiClient, RequestOptions } from '../search/types.js'
import type { ModelConfig, ModelsRegistry, ToolLogger } from '../tools/base-tool.js'
import type { CrudAction, EndpointResolverConfig } from './endpoint-resolver.js'
import { EndpointResolver } from './endpoint-resolver.js'

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
        `${desc}Use find_model to look up existing records.`
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

export class ModelService {
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

    const endpoint = this._resolver.resolveCollection(
      { model, modelConfig, attributes, parentPath: options?.parentPath },
      'create' as CrudAction
    )
    const payload = this._buildPayload(model, modelConfig, attributes)

    this._log('info', 'Creating model', { model, impersonating: options?.userId ?? null })
    const data = await this._apiClient.post(endpoint, payload, options)
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
    return await this._apiClient.get(endpoint, {}, options)
  }

  /** List records with optional filters and pagination. Supports parentPath for nested resources. */
  async list(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateModel(model)
    const endpoint = this._resolver.resolveCollection(
      { model, modelConfig, parentPath: options?.parentPath },
      'list' as CrudAction
    )

    const queryParams = {
      ...filters,
      page: pagination?.page ?? 1,
      per_page: pagination?.perPage ?? 20
    }

    this._log('info', 'Listing models', { model, impersonating: options?.userId ?? null })
    return await this._apiClient.get(endpoint, queryParams, options)
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
    const payload = this._buildPayload(model, modelConfig, attributes)

    this._log('info', 'Updating model', {
      model,
      recordId,
      impersonating: options?.userId ?? null
    })
    const data = await this._apiClient.patch(endpoint, payload, options)
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
    return await this._apiClient.delete(endpoint, options)
  }

  /**
   * Execute a custom action declared on a model.
   *
   * Resolves the endpoint and HTTP method from the model's actions config,
   * builds the payload using the model's convention (unless rawPayload), and
   * dispatches through ApiClient.
   */
  async action(
    model: string,
    actionName: string,
    options?: {
      recordId?: string
      /** Named path parameters for :param_name substitution. */
      pathParams?: Record<string, string>
      attributes?: Record<string, unknown>
      params?: Record<string, unknown>
      requestOptions?: ModelRequestOptions
    }
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._validateModel(model)

    const { url, method } = this._resolver.resolveAction({
      model,
      modelConfig,
      action: actionName,
      recordId: options?.recordId,
      pathParams: options?.pathParams,
      parentPath: options?.requestOptions?.parentPath
    })

    // Build payload for body-bearing methods
    let payload: Record<string, unknown> | undefined
    if (options?.attributes && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const actionDef = (modelConfig.api as Record<string, unknown>)?.actions as
        | Record<string, ActionDefinition>
        | undefined
      payload = actionDef?.[actionName]?.rawPayload
        ? options.attributes
        : this._buildPayload(model, modelConfig, options.attributes)
    }

    this._log('info', 'Executing action', {
      model,
      action: actionName,
      method,
      url,
      impersonating: options?.requestOptions?.userId ?? null
    })

    const result = await this._dispatch(
      method,
      url,
      payload,
      options?.params,
      options?.requestOptions
    )

    this._log('info', 'Action completed', { model, action: actionName })
    return result
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

  // --- Internal helpers ---

  /** Dispatch an HTTP request to the appropriate ApiClient method. */
  private async _dispatch(
    method: string,
    url: string,
    payload?: Record<string, unknown>,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    switch (method) {
      case 'GET':
        return this._apiClient.get(url, params, options)
      case 'POST':
        return this._apiClient.post(url, payload, options)
      case 'PUT':
        return this._apiClient.put(url, payload, options)
      case 'PATCH':
        return this._apiClient.patch(url, payload, options)
      case 'DELETE':
        return this._apiClient.delete(url, options)
      default:
        throw new Error(`Unsupported HTTP method: ${method}`)
    }
  }

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

  /** Build request payload using convention. */
  private _buildPayload(
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

  /** Get the convention for a model. */
  private _getConvention(modelConfig: ModelConfig): BaseConvention {
    return modelConfig.api?.convention ?? defaultConvention
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
