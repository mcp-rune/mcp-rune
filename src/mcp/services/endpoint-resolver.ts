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
 * Custom actions extend the resolver with `resolveAction()`, supporting
 * Rails-style named parameters (e.g., ':id/chapters/:chapter_id/approve')
 * and any HTTP method.
 */

import type { ActionDefinition } from '../../core/base-model.js'
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
  /** Record ID for record-level operations (simple or compound). */
  recordId?: string
  /** Parent path for nested collection operations (e.g., 'titles/42/assets'). */
  parentPath?: string
  /** Attributes hash — used for payload building. */
  attributes?: Record<string, unknown>
}

/** Context for custom action resolution. */
export interface ActionContext extends EndpointContext {
  /** The action name as declared in the model's actions config. */
  action: string
  /** Named path parameters for Rails-style substitution (e.g., { chapter_id: '5' }). */
  pathParams?: Record<string, string>
}

/** CRUD action type for per-action endpoint resolution. */
export type CrudAction = 'list' | 'find' | 'create' | 'update' | 'delete'

// ============================================================================
// Errors
// ============================================================================

/** Thrown when a nested-only model is missing required parent context. */
export class MissingParentError extends Error {
  constructor(model: string, parentModels: string[]) {
    super(
      `'${model}' is nested-only — provide parent_path ` +
        `(e.g., '{parent_endpoint}/{parent_id}/${model}s'). ` +
        `Valid parents: ${parentModels.join(', ')}.`
    )
    this.name = 'MissingParentError'
  }
}

/** Thrown when a custom action is not declared on a model. */
export class UnknownActionError extends Error {
  constructor(model: string, action: string, available: string[]) {
    super(
      `Unknown action '${action}' on model '${model}'. ` +
        `Available actions: ${available.length ? available.join(', ') : 'none'}.`
    )
    this.name = 'UnknownActionError'
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
      throw new MissingParentError(ctx.model, parentModels)
    }

    // 5. Namespace + pathForType
    return this._applyNamespace(ctx.modelConfig, this.pathForType(ctx.model, ctx.modelConfig))
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
      return this._applyNamespace(ctx.modelConfig, recordId)
    }

    // 4. Namespace + pathForType + /recordId
    const base = this._applyNamespace(ctx.modelConfig, this.pathForType(ctx.model, ctx.modelConfig))
    return recordId ? `${base}/${recordId}` : base
  }

  /**
   * Resolve the endpoint and HTTP method for a custom action.
   *
   * Resolution:
   *   1. Look up action definition from modelConfig.api.actions
   *   2. Substitute :id with recordId (special-cased for ergonomics)
   *   3. Substitute remaining :param_name placeholders from pathParams
   *   4. Validate no unsubstituted placeholders remain
   *   5. Compound ID (recordId contains '/') — skip base prepend
   *   6. Simple ID or collection-level — prepend pathForType
   *   7. Apply namespace
   */
  resolveAction(ctx: ActionContext): { url: string; method: string } {
    const actions = (ctx.modelConfig.api as Record<string, unknown>)?.actions as
      | Record<string, ActionDefinition>
      | undefined
    const actionDef = actions?.[ctx.action]
    if (!actionDef) {
      throw new UnknownActionError(ctx.model, ctx.action, Object.keys(actions ?? {}))
    }

    let path = actionDef.path
    const isCompound = ctx.recordId?.includes('/')

    // 1. Substitute :id with recordId (the primary record parameter)
    if (ctx.recordId && path.includes(':id')) {
      path = path.replace(':id', ctx.recordId)
    }

    // 2. Substitute all remaining :param_name placeholders from pathParams
    if (ctx.pathParams) {
      for (const [key, value] of Object.entries(ctx.pathParams)) {
        path = path.replace(`:${key}`, value)
      }
    }

    // 3. Validate no unsubstituted placeholders remain
    const remaining = path.match(/:[a-z_]+/g)
    if (remaining) {
      throw new Error(
        `Unresolved path parameters in action '${ctx.action}' on '${ctx.model}': ` +
          `${remaining.join(', ')}. Provide values via recordId or pathParams.`
      )
    }

    // 4. Compound IDs encode the full hierarchy (same as resolveRecord step 3).
    //    Only prepend base endpoint for simple IDs or collection-level actions.
    if (!isCompound) {
      const base = this.pathForType(ctx.model, ctx.modelConfig)
      path = `${base}/${path}`
    }

    return {
      url: this._applyNamespace(ctx.modelConfig, path),
      method: actionDef.method ?? 'POST'
    }
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
