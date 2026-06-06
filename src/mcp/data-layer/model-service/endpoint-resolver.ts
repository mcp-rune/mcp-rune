/**
 * EndpointResolver — Layered URL resolution for model CRUD operations.
 *
 * Inspired by Ember Data's Adapter pattern, this class provides a resolution
 * chain that gracefully degrades from explicit per-action overrides down to
 * convention-based defaults:
 *
 *   1. Per-action override   (e.g., api.endpoints.create → 'books/draft')
 *   2. Collection override   (e.g., api.endpoints.collection → 'catalogue/book-items')
 *   3. Parent path           (compound ID context for nested resources)
 *   4. Namespace + convention (namespace + modelConfig.api.endpoint)
 *   5. Base convention       (modelConfig.api.endpoint)
 *
 * Supports compound IDs (e.g., 'titles/42/assets/7') that encode the full
 * resource hierarchy, eliminating the need for separate nested routing logic.
 *
 * Custom-action URL resolution lives in the `custom-actions` ApiExtension
 * (@mcp-rune/mcp-rune/api-extensions/custom-actions), which composes
 * `pathForType()` and `applyNamespace()` from this class.
 */

import type { EndpointOverrides } from '../../models/base-model.js'
import type { ModelConfig } from '../../tools/base-tool.js'

export type { EndpointOverrides } from '../../models/base-model.js'

// ============================================================================
// Types
// ============================================================================

/** Configuration for the EndpointResolver instance (server-wide defaults). */
export interface EndpointResolverConfig {
  /** Server-wide API namespace prefix (e.g., 'api/v1'). */
  namespace?: string
}

/** Context needed to resolve an endpoint. */
export interface EndpointContext {
  /** Model name (e.g., 'book'). */
  model: string
  /** Model configuration from the registry. */
  modelConfig: ModelConfig
  /** Record ID for record-level operations (simple or compound). */
  recordId?: string
  /** Parent path for nested collection operations (e.g., 'titles/42/assets'). */
  parentPath?: string
  /** Attributes hash — used for payload building. */
  attributes?: Record<string, unknown>
}

/** CRUD action type for per-action endpoint resolution. */
export type CrudAction = 'list' | 'find' | 'create' | 'update' | 'delete'

// ============================================================================
// Errors
// ============================================================================

/** Thrown when a nested-only model is missing required parent context. */
export class MissingParentError extends Error {
  readonly model: string
  readonly childEndpoint: string
  readonly parentModels: string[]

  constructor(model: string, childEndpoint: string, parentModels: string[]) {
    super(
      `'${model}' is nested-only — provide parent_path ` +
        `(e.g., '{parent_endpoint}/{id}/${childEndpoint}'). ` +
        `Valid parents: ${parentModels.join(', ')}.`
    )
    this.name = 'MissingParentError'
    this.model = model
    this.childEndpoint = childEndpoint
    this.parentModels = parentModels
  }
}

// ============================================================================
// EndpointResolver
// ============================================================================

export class EndpointResolver {
  private _namespace?: string

  constructor(config?: EndpointResolverConfig) {
    this._namespace = config?.namespace
  }

  /**
   * Resolve the endpoint for a collection-level operation (list or create).
   *
   * Resolution chain:
   *   1. Per-action override (endpoints.create for 'create', none for 'list')
   *   2. Collection override (endpoints.collection)
   *   3. Parent path (for nested resource collections)
   *   4. Namespace + pathForType
   */
  resolveCollection(ctx: EndpointContext, action?: CrudAction): string {
    const overrides = this._getOverrides(ctx.modelConfig)

    // 1. Per-action override
    if (action && action !== 'list') {
      const override = overrides?.[action as keyof EndpointOverrides]
      if (override) return override
    }

    // 2. Collection override
    if (overrides?.collection) {
      return overrides.collection
    }

    // 3. Parent path (replaces both parentResource and pathTemplate routing)
    if (ctx.parentPath) {
      return ctx.parentPath
    }

    // 4. Validate nested-only models have parent context
    if (ctx.modelConfig.api?.standalone === false) {
      const parent = ctx.modelConfig.api?.parent
      const parentModels = parent ? (Array.isArray(parent) ? parent : [parent]) : []
      throw new MissingParentError(ctx.model, ctx.modelConfig.api.endpoint, parentModels)
    }

    // 5. Namespace + pathForType
    return this.applyNamespace(ctx.modelConfig, this.pathForType(ctx.model, ctx.modelConfig))
  }

  /**
   * Resolve the endpoint for a record-level operation (find, update, delete).
   *
   * Resolution chain:
   *   1. Per-action override with :id substitution
   *   2. Record override with :id substitution
   *   3. Compound ID (contains '/') — used as full path
   *   4. Namespace + pathForType + /recordId
   */
  resolveRecord(ctx: EndpointContext, action?: CrudAction): string {
    const overrides = this._getOverrides(ctx.modelConfig)
    const recordId = ctx.recordId

    // 1. Per-action override with :id substitution
    if (action && overrides?.[action as keyof EndpointOverrides]) {
      const override = overrides[action as keyof EndpointOverrides] as string
      return recordId ? override.replace(':id', recordId) : override
    }

    // 2. Record override with :id substitution
    if (overrides?.record) {
      return recordId ? overrides.record.replace(':id', recordId) : overrides.record
    }

    // 3. Compound ID — use as full path (apply namespace only)
    if (recordId?.includes('/')) {
      return this.applyNamespace(ctx.modelConfig, recordId)
    }

    // 4. Namespace + pathForType + /recordId
    const base = this.applyNamespace(ctx.modelConfig, this.pathForType(ctx.model, ctx.modelConfig))
    return recordId ? `${base}/${recordId}` : base
  }

  /**
   * Convention hook: derive the API path from a model name.
   *
   * Default implementation returns modelConfig.api.endpoint unchanged.
   * Override in subclasses for APIs that use different naming conventions
   * (e.g., dasherize, underscore, or custom mappings).
   */
  pathForType(_model: string, modelConfig: ModelConfig): string {
    return modelConfig.api.endpoint
  }

  /**
   * Apply the effective namespace to a path.
   *
   * Model-level namespace overrides server-wide namespace. Public so
   * `ApiExtension`s that resolve their own URLs (e.g. custom-actions)
   * compose the same namespace logic as core CRUD.
   */
  applyNamespace(modelConfig: ModelConfig, path: string): string {
    const ns = this._resolveNamespace(modelConfig)
    if (!ns) return path
    return `${ns}/${path}`
  }

  // --- Private helpers ---

  /** Get endpoint overrides from model config, if any. */
  private _getOverrides(modelConfig: ModelConfig): EndpointOverrides | undefined {
    return modelConfig.api?.endpoints
  }

  /**
   * Resolve the effective namespace: model-level > server-wide > none.
   */
  private _resolveNamespace(modelConfig: ModelConfig): string | undefined {
    return modelConfig.api?.namespace ?? this._namespace
  }
}
