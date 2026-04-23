/**
 * EndpointResolver — Layered URL resolution for model CRUD operations.
 *
 * Inspired by Ember Data's Adapter pattern, this class provides a resolution
 * chain that gracefully degrades from explicit per-action overrides down to
 * convention-based defaults:
 *
 *   1. Per-action override   (e.g., api.endpoints.create → 'books/draft')
 *   2. Collection override   (e.g., api.endpoints.collection → 'catalogue/book-items')
 *   3. Nested routing        (pathTemplate with :parentKey substitution)
 *   4. Namespace + convention (namespace + modelConfig.endpoint)
 *   5. Base convention       (modelConfig.endpoint)
 *
 * This consolidates endpoint resolution logic that was previously scattered
 * across CreateModelTool, BulkActionModelsTool, FindModelTool, etc.
 */

import type { ModelConfig } from '../tools/base-tool.js'

// ============================================================================
// Types
// ============================================================================

/** Configuration for the EndpointResolver instance (server-wide defaults). */
export interface EndpointResolverConfig {
  /** Server-wide API namespace prefix (e.g., 'api/v1'). */
  namespace?: string
}

/** Per-action endpoint overrides declared on a model's ApiConfig. */
export interface EndpointOverrides {
  /** Override for collection operations (list, create). */
  collection?: string
  /** Override for record operations (find, update, delete). */
  record?: string
  /** Action-specific overrides — take highest priority. */
  create?: string
  update?: string
  delete?: string
}

/** Context needed to resolve an endpoint. */
export interface EndpointContext {
  /** Model name (e.g., 'book'). */
  model: string
  /** Model configuration from the registry. */
  modelConfig: ModelConfig
  /** Record ID for record-level operations. */
  recordId?: string
  /** Attributes hash — used to extract parentKey for nested routing. */
  attributes?: Record<string, unknown>
  /** Explicit parent resource path override (used by bulk operations). */
  parentResource?: string
}

/** CRUD action type for per-action endpoint resolution. */
export type CrudAction = 'list' | 'find' | 'create' | 'update' | 'delete'

// ============================================================================
// Errors
// ============================================================================

/** Thrown when a nested-only model is missing a required parent ID. */
export class MissingParentError extends Error {
  constructor(model: string, parentKey: string) {
    super(`'${model}' requires parent. Provide '${parentKey}' in attributes.`)
    this.name = 'MissingParentError'
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
   *   3. Explicit parentResource (bulk operations)
   *   4. Nested routing (pathTemplate + parentKey from attributes)
   *   5. Namespace + pathForType
   */
  resolveCollection(ctx: EndpointContext, action?: CrudAction): string {
    const overrides = this._getOverrides(ctx.modelConfig)

    // 1. Per-action override
    if (action && action !== 'list' && overrides?.[action]) {
      return overrides[action]!
    }

    // 2. Collection override
    if (overrides?.collection) {
      return overrides.collection
    }

    // 3. Explicit parentResource (bulk operations pass this directly)
    if (ctx.parentResource) {
      return ctx.parentResource
    }

    // 4. Nested routing
    const nested = ctx.modelConfig.api?.nested
    if (nested?.pathTemplate && ctx.attributes) {
      const parentKey = nested.parentKey
      const parentId = parentKey ? (ctx.attributes[parentKey] as string | undefined) : undefined

      if (nested.nestedOnly) {
        if (!parentId) {
          throw new MissingParentError(ctx.model, parentKey!)
        }
        return nested.pathTemplate.replace(`:${parentKey}`, parentId)
      }

      if (parentId) {
        return nested.pathTemplate.replace(`:${parentKey}`, parentId)
      }
    }

    // 5. Namespace + pathForType
    return this._applyNamespace(ctx.modelConfig, this.pathForType(ctx.model, ctx.modelConfig))
  }

  /**
   * Resolve the endpoint for a record-level operation (find, update, delete).
   *
   * Resolution chain:
   *   1. Per-action override (endpoints.update, endpoints.delete)
   *   2. Record override (endpoints.record) with :id substitution
   *   3. Namespace + pathForType + /recordId
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

    // 3. Namespace + pathForType + /recordId
    const base = this._applyNamespace(ctx.modelConfig, this.pathForType(ctx.model, ctx.modelConfig))
    return recordId ? `${base}/${recordId}` : base
  }

  /**
   * Resolve endpoint for nested child resources (parent/:id/children).
   */
  resolveNested(parentConfig: ModelConfig, parentId: string, childPath: string): string {
    const parentBase = this._applyNamespace(parentConfig, parentConfig.endpoint)
    return `${parentBase}/${parentId}/${childPath}`
  }

  /**
   * Convention hook: derive the API path from a model name.
   *
   * Default implementation returns modelConfig.endpoint unchanged.
   * Override in subclasses for APIs that use different naming conventions
   * (e.g., dasherize, underscore, or custom mappings).
   */
  pathForType(_model: string, modelConfig: ModelConfig): string {
    return modelConfig.endpoint
  }

  // --- Private helpers ---

  /** Get endpoint overrides from model config, if any. */
  private _getOverrides(modelConfig: ModelConfig): EndpointOverrides | undefined {
    return (modelConfig.api as Record<string, unknown> | undefined)?.endpoints as
      | EndpointOverrides
      | undefined
  }

  /**
   * Apply the effective namespace to a path.
   * Model-level namespace overrides server-wide namespace.
   */
  private _applyNamespace(modelConfig: ModelConfig, path: string): string {
    const ns = this._resolveNamespace(modelConfig)
    if (!ns) return path
    return `${ns}/${path}`
  }

  /**
   * Resolve the effective namespace: model-level > server-wide > none.
   */
  private _resolveNamespace(modelConfig: ModelConfig): string | undefined {
    const modelNs = (modelConfig.api as Record<string, unknown> | undefined)?.namespace as
      | string
      | undefined
    return modelNs ?? this._namespace
  }
}
