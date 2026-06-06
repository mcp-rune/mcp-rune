/**
 * Custom Actions extension — opt-in support for non-CRUD HTTP verbs on models.
 *
 * Models declare custom actions (publish, archive, bulk-action, etc.) via the
 * `extensions['custom-actions']` slice on their `static extensions` bag. The
 * extension registers:
 *   - The `model_action` MCP tool, which exposes custom actions to LLMs and
 *     gates its enum input on `getModelsWithActions()`.
 *   - A `ModelService` mixin that adds `action(model, name, options?)`,
 *     resolving the URL via the layered chain (Rails-style :id and :param
 *     substitution, compound-ID-aware base prepend, namespace application)
 *     and dispatching through `ModelService.dispatch()` after optionally
 *     wrapping the payload with the model's convention.
 *
 * This is the first concrete `ApiExtension`. Conventional registration key
 * is `custom-actions`. Usage:
 *
 * ```ts
 * import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
 * import {
 *   customActionsExtension,
 *   customActionsConfig
 * } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'
 *
 * class Book extends BaseModel {
 *   static api = { endpoint: 'books' }
 *   static extensions = {
 *     'custom-actions': customActionsConfig({
 *       actions: { publish: { path: ':id/publish' } }
 *     })
 *   }
 * }
 *
 * new ToolRegistry({
 *   toolClasses: DATA_TOOL_CLASSES,
 *   models: { book: Book },
 *   createApiClient,
 *   apiExtensions: {
 *     'custom-actions': customActionsExtension()
 *   }
 * })
 * ```
 */

import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ApiExtension, ModelServiceMixin } from '#src/mcp/data-layer/api-extensions/types.js'
import type { EndpointResolver } from '#src/mcp/data-layer/model-service/endpoint-resolver.js'
import type { ModelRequestOptions } from '#src/mcp/data-layer/model-service/model-service.js'
import { UnknownModelError } from '#src/mcp/data-layer/model-service/model-service.js'
import type {
  ModelConfig,
  ModelsRegistry,
  ToolAnnotations,
  ToolResult
} from '#src/mcp/tools/base-tool.js'
import { BaseTool } from '#src/mcp/tools/base-tool.js'

// ============================================================================
// Types
// ============================================================================

/** Definition of a single custom action on a model. */
export interface ActionDefinition {
  /** HTTP method. Defaults to 'POST'. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /**
   * URL path template with Rails-style named parameters.
   * Supports :id (mapped from recordId) and any :param_name (mapped from pathParams).
   * Relative paths are resolved against the model's base endpoint.
   *
   * Examples:
   *   ':id/publish'                              — single record action
   *   ':id/chapters/:chapter_id/approve'          — nested action with extra param
   *   'reports/:report_type/:year/generate'       — collection action with params
   *   'bulk-publish'                               — collection action, no params
   */
  path: string
  /** Whether this action operates on a specific record (requires recordId). Default: true. */
  recordLevel?: boolean
  /** Description for tooling/documentation. */
  description?: string
  /** When true, send attributes as-is without convention wrapping. Default: false. */
  rawPayload?: boolean
}

/** Per-model configuration consumed by the custom-actions extension. */
export interface CustomActionsConfig {
  actions: Record<string, ActionDefinition>
}

/** Context for resolving a custom action URL. */
export interface ActionContext {
  model: string
  modelConfig: ModelConfig
  action: string
  recordId?: string
  pathParams?: Record<string, string>
}

// ============================================================================
// Errors
// ============================================================================

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
// Public API: typed helpers
// ============================================================================

/**
 * Typed helper for per-model configuration. Use this — not a raw object
 * literal — so TypeScript catches mistakes at the call site even though
 * the extensions bag is `Record<string, unknown>`.
 *
 * ```ts
 * static extensions = {
 *   'custom-actions': customActionsConfig({
 *     actions: { publish: { path: ':id/publish' } }
 *   })
 * }
 * ```
 */
export function customActionsConfig(config: CustomActionsConfig): CustomActionsConfig {
  return config
}

/**
 * Read this extension's slice from a model's `extensions` bag. Returns
 * `undefined` when the model doesn't opt into custom actions, so callers
 * can tolerate the extension being unregistered.
 */
export function getActionsConfig(model: ModelConfig): CustomActionsConfig | undefined {
  return model.extensions?.['custom-actions'] as CustomActionsConfig | undefined
}

/** Get all model names that have at least one declared custom action. */
export function getModelsWithActions(models: ModelsRegistry): string[] {
  return Object.keys(models).filter((name) => {
    const actions = getActionsConfig(models[name]!)?.actions
    return actions && Object.keys(actions).length > 0
  })
}

// ============================================================================
// ActionResolver — composes core EndpointResolver
// ============================================================================

export class ActionResolver {
  constructor(private readonly endpointResolver: EndpointResolver) {}

  /**
   * Resolve URL + HTTP method for a custom action.
   *
   * Resolution:
   *   1. Look up the action definition from the model's `custom-actions` slice
   *   2. Substitute :id with recordId
   *   3. Substitute remaining :param_name placeholders from pathParams
   *   4. Reject if any placeholders remain unsubstituted
   *   5. Compound IDs (recordId contains '/') encode the full hierarchy — skip base prepend
   *   6. Otherwise prepend the model's pathForType
   *   7. Apply effective namespace (model-level overrides server-wide)
   */
  resolveAction(ctx: ActionContext): { url: string; method: string } {
    const actions = getActionsConfig(ctx.modelConfig)?.actions
    const actionDef = actions?.[ctx.action]
    if (!actionDef) {
      throw new UnknownActionError(ctx.model, ctx.action, Object.keys(actions ?? {}))
    }

    let path = actionDef.path
    const isCompound = ctx.recordId?.includes('/')

    if (ctx.recordId && path.includes(':id')) {
      path = path.replace(':id', ctx.recordId)
    }

    if (ctx.pathParams) {
      for (const [key, value] of Object.entries(ctx.pathParams)) {
        path = path.replace(`:${key}`, value)
      }
    }

    const remaining = path.match(/:[a-z_]+/g)
    if (remaining) {
      throw new Error(
        `Unresolved path parameters in action '${ctx.action}' on '${ctx.model}': ` +
          `${remaining.join(', ')}. Provide values via recordId or pathParams.`
      )
    }

    if (!isCompound) {
      const base = this.endpointResolver.pathForType(ctx.model, ctx.modelConfig)
      path = `${base}/${path}`
    }

    return {
      url: this.endpointResolver.applyNamespace(ctx.modelConfig, path),
      method: actionDef.method ?? 'POST'
    }
  }
}

// ============================================================================
// ModelService mixin — adds `action()`
// ============================================================================

/** Options accepted by `ModelService.action()`. */
export interface ActionInvocationOptions {
  recordId?: string
  pathParams?: Record<string, string>
  attributes?: Record<string, unknown>
  params?: Record<string, unknown>
  requestOptions?: ModelRequestOptions
}

/** The mixin contract added to `ModelService` when this extension is registered. */
export interface ActionServiceMethods {
  action(
    model: string,
    actionName: string,
    options?: ActionInvocationOptions
  ): Promise<Record<string, unknown>>
}

const actionsMixin: ModelServiceMixin = (service) => {
  const resolver = new ActionResolver(service.endpointResolver)

  const action = async (
    model: string,
    actionName: string,
    options?: ActionInvocationOptions
  ): Promise<Record<string, unknown>> => {
    const modelConfig = service.models[model]
    if (!modelConfig) {
      throw new UnknownModelError(model, Object.keys(service.models))
    }

    const { url, method } = resolver.resolveAction({
      model,
      modelConfig,
      action: actionName,
      recordId: options?.recordId,
      pathParams: options?.pathParams
    })

    let payload: Record<string, unknown> | undefined
    const def = getActionsConfig(modelConfig)?.actions?.[actionName]
    if (options?.attributes && ['POST', 'PUT', 'PATCH'].includes(method)) {
      payload = def?.rawPayload
        ? options.attributes
        : service.buildPayload(model, modelConfig, options.attributes)
    }

    return service.dispatch(method, url, payload, options?.params, options?.requestOptions)
  }

  return { action: action as unknown as (...args: unknown[]) => unknown }
}

// ============================================================================
// MCP tool — `model_action`
// ============================================================================

/**
 * Tool for executing custom actions on models.
 *
 * Owns MCP concerns (input schema, response formatting, action discovery).
 * Delegates to the `action()` method contributed by the mixin above.
 */
export class ModelActionTool extends BaseTool {
  override get name(): string {
    return 'model_action'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    const actionSummary = this._buildActionSummary()
    return (
      `Execute a custom action on a model${scope}. ` +
      `Actions are model-specific operations beyond standard CRUD.` +
      actionSummary
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(getModelsWithActions(this.models)).describe(
        'Model name with available actions'
      ),
      action: z.string().describe('Action name as declared on the model'),
      record_id: z
        .string()
        .describe(
          'Record ID (required for record-level actions). Supports compound IDs for nested resources.'
        )
        .optional(),
      attributes: z
        .record(z.string(), z.unknown())
        .describe('Action payload attributes (for POST/PUT/PATCH actions)')
        .optional(),
      path_params: z
        .record(z.string(), z.string())
        .describe("Named path parameters for URL template substitution (e.g., { chapter_id: '5' })")
        .optional(),
      params: z
        .record(z.string(), z.unknown())
        .describe('Query parameters (for GET actions)')
        .optional(),
      user_id: z.string().describe('User ID to impersonate (service accounts only).').optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const service = this.requireDataLayer() as unknown as ActionServiceMethods

      const { model, action, record_id, attributes, path_params, params, user_id } = args as {
        model: string
        action: string
        record_id?: string
        attributes?: Record<string, unknown>
        path_params?: Record<string, string>
        params?: Record<string, unknown>
        user_id?: string
      }

      this.validateModel(model)

      const data = await service.action(model, action, {
        recordId: record_id,
        pathParams: path_params,
        attributes,
        params,
        requestOptions: user_id ? { userId: user_id } : undefined
      })

      return this.formatResponse({ status: 'success', model, action, data })
    } catch (error) {
      if (error instanceof UnknownActionError) {
        return {
          content: [{ type: 'text', text: error.message }],
          isError: true
        }
      }
      return this.formatError(error as Error)
    }
  }

  /** Build a summary of available actions for the tool description. */
  private _buildActionSummary(): string {
    const lines: string[] = []
    for (const [model, config] of Object.entries(this.models)) {
      const actions = getActionsConfig(config)?.actions
      if (!actions) continue
      const entries = Object.entries(actions)
      if (entries.length > 0) {
        const actionDescriptions = entries
          .map(([name, def]) => {
            const method = def.method ?? 'POST'
            const desc = def.description ? ` — ${def.description}` : ''
            return `  ${name} (${method})${desc}`
          })
          .join('\n')
        lines.push(`${model}:\n${actionDescriptions}`)
      }
    }
    return lines.length > 0 ? `\n\nAvailable actions:\n${lines.join('\n')}` : ''
  }
}

// ============================================================================
// Extension factory
// ============================================================================

/**
 * The opt-in `custom-actions` API extension. Register on `ToolRegistry` to
 * enable the `model_action` MCP tool and the `ModelService.action()` method.
 *
 * Conventional registration key: `custom-actions`.
 */
export function customActionsExtension(): ApiExtension {
  return {
    register(ctx) {
      ctx.registerTool('model_action', ModelActionTool)
      ctx.registerModelServiceMixin(actionsMixin)
    }
  }
}
