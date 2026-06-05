/**
 * ToolRegistry - Convention-based tool registration
 *
 * Eliminates the boilerplate that every integrator writes: iterate tool classes,
 * validate schemas, register with McpServer, wrap handlers with auth/tracing/logging/error catching.
 *
 * Replaces ~100 lines of duplicated registry code per server with a constructor call.
 *
 * @example
 * import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
 *
 * const toolRegistry = new ToolRegistry({
 *   toolClasses: DATA_TOOL_CLASSES,
 *   models: MODEL_CLASSES,
 *   serverContext: { name: 'My Server', namespace: 'my-server' },
 *   createApiClient: (token) => createApiClient(token, { apiUrl }),
 * })
 *
 * // Complex setup with interceptors and capability gating:
 * const toolRegistry = new ToolRegistry({
 *   toolClasses: { ...DATA_TOOL_CLASSES, ...DOMAIN_TOOL_CLASSES, custom_tool: MyTool },
 *   models: MODEL_CLASSES,
 *   serverContext,
 *   promptRegistry,
 *   domainRegistry,
 *   createApiClient: (token) => createApiClient(token, { apiUrl }),
 *   vectorStorageEnabled: vectorStorage.isEnabled(),
 *   interceptors: [myAuditInterceptor],
 * })
 *
 * // Tools whose static `requires*` flag is true are filtered out when the
 * // corresponding registry dependency is absent — `requiresDomainRegistry`
 * // when `domainRegistry` is unset, `requiresPromptRegistry` when
 * // `promptRegistry` is unset, and `requiresVectorStorage` when
 * // `vectorStorageEnabled` is false.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { ApiClient } from '#src/core/api-client.js'
import type { DataLayer, DataLayerFactory } from '#src/core/data-layer.js'
import {
  BUILT_IN_SUMMARY_STRATEGIES,
  SummaryStrategyRegistry
} from '#src/core/summary-strategies/index.js'
import type {
  ApiExtensionContext,
  ApiExtensionMap,
  ModelServiceMixin
} from '#src/mcp/api-extensions/types.js'
import { ModelService } from '#src/mcp/services/model-service.js'
import * as logger from '#src/services/logger.js'
import * as tracing from '#src/services/tracing.js'

import type {
  DomainRegistry,
  ModelsRegistry,
  PromptRegistry,
  ServerContext,
  ToolDependencies,
  ToolHandlerExtra,
  ToolLogger,
  ToolResult
} from './base-tool.js'
import type { BaseTool } from './base-tool.js'
import { errorInterceptor, loggingInterceptor } from './interceptors.js'
import type { ToolInterceptor } from './tool-pipeline.js'
import { wrapToolHandler } from './tool-pipeline.js'
import { validateToolSchema } from './validators.js'

/**
 * A recursive Proxy used as a stand-in `ModelService` during boot-time mixin
 * factory invocation. The factory is called once per registration just to
 * collect the method names it contributes — the actual `service` argument is
 * bound lazily per tool instance via the `DataLayer` factory. Any property
 * chain on the sentinel returns another callable Proxy so factories that
 * dereference `service.endpointResolver.pathForType(...)` at factory time
 * (rather than inside their returned methods) still evaluate cleanly.
 */
const SENTINEL_MODEL_SERVICE: ModelService = (() => {
  const handler: ProxyHandler<() => void> = {
    get: () => new Proxy(() => undefined, handler),
    apply: () => new Proxy(() => undefined, handler)
  }
  return new Proxy(() => undefined, handler) as unknown as ModelService
})()

// ============================================================================
// Types
// ============================================================================

/**
 * A tool class constructor. Static metadata fields drive registry behavior:
 * - `requiresAuth` — whether to inject an authenticated `dataLayer` (default true on `BaseTool`).
 * - `requiresVectorStorage` — skip registration when vector storage is unavailable.
 * - `requiresDomainRegistry` — skip registration when no `domainRegistry` was passed.
 * - `requiresPromptRegistry` — skip registration when no `promptRegistry` was passed.
 *
 * All are declared on `BaseTool` with safe defaults; family bases
 * (`BaseStrategyTool`, `BaseAnalysisTool`, `BaseOperationsTool`,
 * `BaseDomainTool`) override declaratively.
 */
export interface ToolClass {
  new (deps: ToolDependencies): BaseTool
  readonly requiresAuth: boolean
  readonly requiresVectorStorage: boolean
  readonly requiresDomainRegistry: boolean
  readonly requiresPromptRegistry: boolean
}

/** Map of tool names to tool class constructors */
export type ToolClassMap = Record<string, ToolClass>

/** Function that creates an authenticated API client from a bearer token */
export type ApiClientFactory = (token: string) => ApiClient

export interface ToolRegistryConfig {
  /** Tool classes to register (e.g., { ...DATA_TOOL_CLASSES, custom_tool: MyTool }) */
  toolClasses: ToolClassMap

  /** Models configuration (passed to all tool instances) */
  models: ModelsRegistry

  /** Server context for disambiguation (passed to all tool instances) */
  serverContext?: ServerContext

  /** Logger instance (defaults to mcp-rune logger) */
  logger?: ToolLogger

  /** Prompt registry (passed to tools that need it, e.g., strategy tools) */
  promptRegistry?: PromptRegistry

  /** Domain intelligence registry (passed to domain tools) */
  domainRegistry?: DomainRegistry

  /**
   * Factory function to create an authenticated API client from a bearer token.
   * Called per tool invocation for tools with `requiresAuth: true`.
   *
   * @example
   * createApiClient: (token) => createApiClient(token, { apiUrl: 'https://api.example.com' })
   */
  createApiClient?: ApiClientFactory

  /**
   * Optional `DataLayer` factory. Lets integrators swap the default
   * `ModelService` adapter for an alternative implementation (in-memory
   * stub, third-party library wrapper, etc.). When omitted, the registry
   * wraps `ModelService` and applies any `ApiExtension` mixins.
   *
   * The factory is invoked per authenticated tool invocation with the
   * fresh `ApiClient` produced by `createApiClient`.
   */
  dataLayer?: DataLayerFactory

  /**
   * Server-wide namespace prefix passed to the default `ModelService`
   * adapter. Ignored when a custom `dataLayer` factory is supplied.
   */
  namespace?: string

  /**
   * Whether vector storage (pgvector) is available. Tools with
   * `static requiresVectorStorage = true` are skipped when false.
   *
   * `requiresDomainRegistry` and `requiresPromptRegistry` are gated
   * implicitly by the presence of `domainRegistry` and `promptRegistry`
   * config options — no separate flag needed.
   */
  vectorStorageEnabled?: boolean

  /**
   * Custom interceptors applied to every tool handler.
   * Built-in interceptors (logging, error-catch) are always applied;
   * custom interceptors run between logging and error-catch.
   *
   * Order: [logging, ...custom, error-catch]
   * Tracing wraps the entire chain externally via traceToolCall.
   */
  interceptors?: ToolInterceptor[]

  /**
   * Opt-in `ApiExtension`s. Each extension may contribute MCP tools and
   * `ModelService` mixin methods. Registered synchronously at construction:
   * capability validation and tool-name collision detection happen here, so
   * misconfiguration surfaces at boot rather than as a missing tool at runtime.
   *
   * Keys are user-chosen identifiers used for log lines and the dedupe
   * primitive (object semantics guarantee key uniqueness). Built-in
   * extensions document their conventional key.
   *
   * See `docs/guides/api-extensions.md`.
   */
  apiExtensions?: ApiExtensionMap
}

// ============================================================================
// ToolRegistry
// ============================================================================

export class ToolRegistry {
  readonly serverContext: Record<string, unknown>

  private _toolClasses: ToolClassMap
  private _models: ModelsRegistry
  private _logger: ToolLogger
  private _promptRegistry: PromptRegistry | undefined
  private _domainRegistry: DomainRegistry | undefined
  private _createApiClient: ApiClientFactory | undefined
  private _dataLayerFactory: DataLayerFactory
  private _namespace: string | undefined
  private _vectorStorageEnabled: boolean
  private _interceptors: ToolInterceptor[]
  private _enabledTools: Set<string> | null = null
  private _modelServiceMixins: ModelServiceMixin[] = []
  /** Tracks which extension contributed each tool name, for collision diagnostics. */
  private _toolOwners: Map<string, string> = new Map()
  /** Tracks which extension contributed each mixin method name, for collision diagnostics. */
  private _mixinMethodOwners: Map<string, string> = new Map()
  private _summaryStrategies: SummaryStrategyRegistry

  constructor(config: ToolRegistryConfig) {
    this._toolClasses = { ...config.toolClasses }
    this._models = config.models
    this._logger = config.logger ?? logger
    this._promptRegistry = config.promptRegistry
    this._domainRegistry = config.domainRegistry
    this._createApiClient = config.createApiClient
    this._namespace = config.namespace
    this._vectorStorageEnabled = config.vectorStorageEnabled ?? false
    this._interceptors = config.interceptors ?? []
    this.serverContext = (config.serverContext as Record<string, unknown>) ?? {}

    // Seed with built-ins before _applyApiExtensions runs so extensions can
    // (in Step 3) contribute additional strategies with collision detection
    // against the built-ins.
    this._summaryStrategies = new SummaryStrategyRegistry(BUILT_IN_SUMMARY_STRATEGIES)

    // Default DataLayer factory wraps ModelService and applies extension mixins.
    // Integrators can override to back the projection layer with a different
    // adapter (in-memory stub, third-party library, etc.).
    const mixins = this._modelServiceMixins
    this._dataLayerFactory =
      config.dataLayer ??
      (({ apiClient, models, namespace, logger: log }): DataLayer => {
        if (!apiClient) {
          throw new Error(
            'Default DataLayer factory requires an apiClient. Provide one via createApiClient ' +
              'or supply a custom `dataLayer` factory that does not depend on HTTP.'
          )
        }
        const service = new ModelService({ apiClient, models, namespace, logger: log })
        for (const mixin of mixins) {
          Object.assign(service, mixin(service))
        }
        return service
      })

    if (config.apiExtensions) {
      this._applyApiExtensions(config.apiExtensions)
    }
  }

  /**
   * Register opt-in `ApiExtension`s synchronously at construction.
   *
   * Validates `requires` capabilities, collects contributed tools (throwing
   * on tool-name collisions with both extension keys in the message), and
   * collects `ModelService` mixins (which are applied lazily when each tool
   * instance's `modelService` getter is first read).
   *
   * Errors are thrown synchronously so misconfiguration surfaces at boot.
   */
  private _applyApiExtensions(extensions: ApiExtensionMap): void {
    for (const [name, extension] of Object.entries(extensions)) {
      // Capability validation: reserved for future use; the type is `never`,
      // so any non-empty `requires` array is by definition unsatisfiable today.
      const required = extension.requires ?? []
      for (const capability of required) {
        throw new Error(
          `ApiExtension "${name}" requires capability "${capability as string}", ` +
            `which is not provided by ToolRegistry.`
        )
      }

      extension.register({
        name,
        models: this._models,
        serverContext: this.serverContext as ServerContext,
        logger: this._logger as unknown as ApiExtensionContext['logger'],
        registerTool: (toolName, ToolCls) => {
          const existingOwner = this._toolOwners.get(toolName)
          if (toolName in this._toolClasses) {
            const owner = existingOwner ?? '<core>'
            throw new Error(
              `ApiExtension "${name}" attempted to register tool "${toolName}", ` +
                `which is already registered by "${owner}". Tool names must be globally unique.`
            )
          }
          this._toolClasses[toolName] = ToolCls
          this._toolOwners.set(toolName, name)
        },
        registerModelServiceMixin: (mixin) => {
          // Invoke the factory with a sentinel ModelService just to collect
          // the method names — the actual `service` is bound lazily per tool
          // instance via the DataLayer factory below. Fail fast on duplicate
          // names across extensions (mirrors tool-name and summary-strategy
          // collision rules).
          const methods = mixin(SENTINEL_MODEL_SERVICE)
          for (const methodName of Object.keys(methods)) {
            const existingOwner = this._mixinMethodOwners.get(methodName)
            if (existingOwner !== undefined) {
              throw new Error(
                `ApiExtension "${name}" attempted to register ModelService mixin method ` +
                  `"${methodName}", which is already registered by "${existingOwner}". ` +
                  `Mixin method names must be globally unique across all extensions.`
              )
            }
            this._mixinMethodOwners.set(methodName, name)
          }
          this._modelServiceMixins.push(mixin)
        },
        registerSummaryStrategy: (strategy) => {
          this._summaryStrategies.register(name, strategy)
        }
      })

      this._logger.info(`ApiExtension "${name}" registered`, {
        service: 'tool-registry',
        extensionName: name
      })
    }
  }

  /**
   * Register all enabled tools on an McpServer instance.
   *
   * Each tool is registered with:
   * - Zod input schema validation
   * - Auth wrapping per tool category
   * - Tracing via traceToolCall (outermost wrapper)
   * - Logging via loggingInterceptor
   * - Error catching via errorInterceptor
   * - Custom interceptors in between
   */
  registerTools(
    mcpServer: McpServer,
    options: {
      getAccessToken: () => Promise<string>
      logContext?: Record<string, unknown>
    }
  ): void {
    const { getAccessToken, logContext = {} } = options
    const enabledTools = this._getEnabledTools()

    for (const [toolName, ToolCls] of Object.entries(this._toolClasses)) {
      if (!enabledTools.has(toolName)) continue

      // Create definition instance and validate schema — skip broken tools instead of crashing
      let defInstance: BaseTool
      try {
        defInstance = this._createInstance(ToolCls)
        validateToolSchema(toolName, defInstance.inputSchema)
      } catch (err) {
        const error = err as Error
        this._logger.error('Skipping tool with invalid schema', {
          service: 'tool-registry',
          tool: toolName,
          error: error.message
        })
        continue
      }

      // Build the interceptor chain: [logging, ...custom, error-catch]
      const interceptors: ToolInterceptor[] = [
        loggingInterceptor({ logContext }),
        ...this._interceptors,
        errorInterceptor()
      ]

      // Core handler: create tool instance (with or without auth) and execute
      const coreHandler = async (
        args: Record<string, unknown>,
        extra?: ToolHandlerExtra
      ): Promise<ToolResult> => {
        const instance = ToolCls.requiresAuth
          ? await this._createAuthenticatedInstance(ToolCls, getAccessToken)
          : this._createInstance(ToolCls)

        instance._extra = extra
        return instance.execute(args)
      }

      // Wrap with interceptor chain
      const wrappedHandler = wrapToolHandler(toolName, interceptors, coreHandler)

      // Wrap with tracing as outermost layer (captures full execution including interceptors)
      const tracedHandler = async (
        args: Record<string, unknown>,
        extra?: ToolHandlerExtra
      ): Promise<ToolResult> => {
        return tracing.traceToolCall(toolName, args ?? {}, () => wrappedHandler(args ?? {}, extra))
      }

      mcpServer.registerTool(
        toolName,
        {
          description: defInstance.description,
          inputSchema: defInstance.inputSchema,
          annotations: defInstance.annotations
        },
        // SDK ToolCallback receives (args, extra) — we pass extra through the pipeline
        tracedHandler as unknown as Parameters<McpServer['registerTool']>[2]
      )
    }
  }

  /**
   * Get enabled tool names. Tools are filtered out when one of their
   * static `requires*` flags is true but the corresponding registry
   * dependency is not configured.
   */
  private _getEnabledTools(): Set<string> {
    if (!this._enabledTools) {
      const tools = Object.keys(this._toolClasses).filter((name) => {
        const ToolCls = this._toolClasses[name]!
        if (ToolCls.requiresVectorStorage && !this._vectorStorageEnabled) return false
        if (ToolCls.requiresDomainRegistry && !this._domainRegistry) return false
        if (ToolCls.requiresPromptRegistry && !this._promptRegistry) return false
        return true
      })
      this._enabledTools = new Set(tools)
    }
    return this._enabledTools
  }

  /** Create a tool instance without auth (for definitions or no-auth tools) */
  private _createInstance(ToolCls: ToolClass): BaseTool {
    return new ToolCls({
      logger: this._logger,
      models: this._models,
      promptRegistry: this._promptRegistry,
      serverContext: this.serverContext as ServerContext,
      domainRegistry: this._domainRegistry,
      summaryStrategies: this._summaryStrategies
    })
  }

  /** Create a tool instance with a DataLayer constructed from the session's access token. */
  private async _createAuthenticatedInstance(
    ToolCls: ToolClass,
    getAccessToken: () => Promise<string>
  ): Promise<BaseTool> {
    const token = await getAccessToken()
    if (!token) {
      throw new Error('Not authenticated. Please ensure you are authenticated.')
    }
    if (!this._createApiClient) {
      throw new Error(
        'ToolRegistry requires createApiClient option for tools that need authentication'
      )
    }
    const apiClient = this._createApiClient(token)
    const dataLayer = this._dataLayerFactory({
      apiClient,
      models: this._models,
      namespace: this._namespace,
      logger: this._logger
    })
    return new ToolCls({
      dataLayer,
      logger: this._logger,
      models: this._models,
      promptRegistry: this._promptRegistry,
      serverContext: this.serverContext as ServerContext,
      domainRegistry: this._domainRegistry,
      summaryStrategies: this._summaryStrategies
    })
  }
}
