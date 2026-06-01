import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import { z } from 'zod'
export type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { RequestOptions } from '#src/core/api-client.js'
import type { DataLayer } from '#src/core/data-layer.js'
import type { SummaryStrategyRegistry } from '#src/core/summary-strategies/index.js'
import { storeOperation } from '#src/services/vector-storage.js'

import type { AssociationConfig, BaseConvention } from '../api-conventions/base-convention.js'
import { defaultConvention } from '../api-conventions/index.js'
import type { PromptRegistry } from '../prompts/prompt-registry.js'

export type { PromptRegistry } from '../prompts/prompt-registry.js'

// ============================================================================
// Types
// ============================================================================

export type { RequestOptions }
export type { DataLayer } from '#src/core/data-layer.js'

/** Logger interface expected by tools */
export interface ToolLogger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

/** Server context surfaced to tools (API-scope name, session id, etc.) */
export interface ServerContext {
  name?: string
  sessionId?: string
}

/** Domain intelligence registry */
export interface DomainRegistry {
  [key: string]: unknown
}

/** Filter schema entry used by validators */
export interface FilterSchema {
  type: string
  enumValues?: string[]
  description?: string
  [key: string]: unknown
}

/** Model configuration as stored in the models registry */
export interface ModelConfig {
  attributes?: Record<string, unknown>
  description?: string
  api: {
    /** Base API path for this model (e.g., 'books', 'activities'). */
    endpoint: string
    convention?: BaseConvention
    readOnly?: boolean
    /** Parent model name(s) for nested resources. */
    parent?: string | string[]
    /** Whether the model has a standalone (non-nested) endpoint. Default: true. */
    standalone?: boolean
    /** API namespace prefix (e.g., 'api/v1'). Overrides server-wide default. */
    namespace?: string
    /** Per-action endpoint overrides for non-standard API paths. */
    endpoints?: {
      collection?: string
      record?: string
      create?: string
      update?: string
      delete?: string
    }
  }
  associations?: AssociationConfig & {
    custom?: Record<string, Record<string, unknown>>
  }
  /**
   * Opt-in extension configs, keyed by extension name. Read by each registered
   * `ApiExtension` via its typed `get<X>Config(modelConfig)` helper.
   * See `docs/guides/api-extensions.md`.
   */
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

/** Models registry: model name to model config */
export type ModelsRegistry = Record<string, ModelConfig>

/** Dependencies injected into tool constructors */
export interface ToolDependencies {
  /**
   * The data-access seam. Set by `ToolRegistry` for tools whose category
   * requires authentication; absent for STRATEGY / no-auth tools that do
   * not touch CRUD. Constructed via the registry's `dataLayer` factory
   * with any registered `ApiExtension` mixins already applied.
   */
  dataLayer?: DataLayer
  logger?: ToolLogger
  models?: ModelsRegistry
  promptRegistry?: PromptRegistry
  serverContext?: ServerContext
  domainRegistry?: DomainRegistry
  /**
   * Registry of pluggable summary strategies for the analysis_* tool family.
   * Threaded in by `ToolRegistry`; absent for ad-hoc tool instantiations
   * (which fall back to a process-wide default seeded with built-ins).
   */
  summaryStrategies?: SummaryStrategyRegistry
}

/** Tool response content item */
export interface ToolResponseContent {
  type: 'text'
  text: string
}

/** Tool success response */
export interface ToolSuccessResponse {
  content: ToolResponseContent[]
  _meta?: Record<string, unknown>
}

/** Tool error response */
export interface ToolErrorResponse {
  content: ToolResponseContent[]
  isError: true
}

/** Union of all tool response shapes */
export type ToolResult = ToolSuccessResponse | ToolErrorResponse

/** Subset of SDK RequestHandlerExtra exposed to tools via the pipeline */
export interface ToolHandlerExtra {
  signal?: AbortSignal
  sendNotification?: (notification: {
    method: string
    params: Record<string, unknown>
  }) => Promise<void>
  _meta?: { progressToken?: string | number; [key: string]: unknown }
}

/** Error with optional HTTP response data */
interface HttpError extends Error {
  response?: {
    status?: number
    data?: unknown
  }
}

// ============================================================================
// BaseTool
// ============================================================================

/**
 * Base class for MCP tool implementations
 *
 * All tools extend this class (directly or via a family base — `BaseStrategyTool`,
 * `BaseAnalysisTool`, `BaseOperationsTool`, `BaseDomainTool`) and provide:
 * - name: Tool name
 * - baseDescription: Base tool description (description getter adds sections)
 * - inputSchema: Zod raw shape for tool parameters (e.g., { model: z.string() })
 * - execute(args): Implementation logic
 *
 * Server-specific bases (e.g., EngineerBaseTool) should extend this and:
 * - Override getUsageRules() to add server-specific behavioral rules (e.g. multi-product disambiguation)
 * - Add server-specific helpers
 *
 * Static metadata fields drive registry behavior. `BaseTool` itself defaults
 * to the (former DATA) "needs API auth, no special services" profile —
 * extending it directly is correct for any CRUD-style tool. Family bases
 * override the defaults declaratively (e.g. `BaseStrategyTool` sets
 * `requiresAuth = false`).
 */
export class BaseTool {
  /**
   * Whether this tool needs an authenticated `dataLayer`. When true, the
   * registry resolves the session's access token, constructs a `dataLayer`,
   * and passes it into the tool constructor. When false, the tool is
   * instantiated without a `dataLayer`; calling `requireDataLayer()` would
   * throw. Default: `true` (safe default — opting in is the dangerous case).
   */
  static requiresAuth: boolean = true

  /**
   * Whether this tool requires vector storage (pgvector) to be configured.
   * Tools with `requiresVectorStorage = true` are skipped at registration
   * time when the integrator reports vector storage is not available.
   */
  static requiresVectorStorage: boolean = false

  /**
   * Whether this tool requires a domain registry to be configured. Implicit
   * for `BaseDomainTool` subclasses; integrators don't need to set a
   * separate gate.
   */
  static requiresDomainRegistry: boolean = false

  /**
   * Whether this tool requires a prompt registry to be configured. Implicit
   * for `BaseStrategyTool` subclasses.
   */
  static requiresPromptRegistry: boolean = false

  /**
   * MCP tool annotation defaults for this tool family. Subclasses override
   * to reflect the family's read-only / destructive character. The instance
   * `annotations` getter reads this static field; tools that need
   * per-instance shaping can still override the getter.
   */
  static defaultAnnotations: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  }

  dataLayer: DataLayer | undefined
  logger: ToolLogger | undefined
  models: ModelsRegistry
  promptRegistry: PromptRegistry | undefined
  serverContext: ServerContext
  domainRegistry: DomainRegistry | undefined
  summaryStrategies: SummaryStrategyRegistry | undefined

  /** @internal Set by ToolRegistry before execute(). Exposes SDK request context (progress, abort). */
  _extra?: ToolHandlerExtra

  constructor(dependencies: ToolDependencies = {}) {
    this.dataLayer = dependencies.dataLayer
    this.logger = dependencies.logger
    this.models = dependencies.models ?? {}
    this.promptRegistry = dependencies.promptRegistry
    this.serverContext = dependencies.serverContext ?? {}
    this.domainRegistry = dependencies.domainRegistry
    this.summaryStrategies = dependencies.summaryStrategies
  }

  /** Tool name (override in subclasses) */
  get name(): string {
    throw new Error('Tool must implement name getter')
  }

  /** Base description without sections (override in subclasses) */
  get baseDescription(): string {
    throw new Error('Tool must implement baseDescription getter')
  }

  /** Zod raw shape for tool parameters (override in subclasses) */
  get inputSchema(): Record<string, ZodTypeAny> {
    throw new Error('Tool must implement inputSchema getter')
  }

  /** MCP tool annotations (override in subclasses to customize per-instance) */
  get annotations(): ToolAnnotations {
    return { ...(this.constructor as typeof BaseTool).defaultAnnotations }
  }

  /** Execute tool logic (override in subclasses) */
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    throw new Error('Tool must implement execute method')
  }

  /**
   * Full tool description with usage rules appended.
   * Combines baseDescription + usageRules.
   */
  get description(): string {
    let desc = this.baseDescription

    const rules = this.getUsageRules()
    if (rules.length > 0) {
      desc += '\n\n' + rules.join('\n\n')
    }

    return desc
  }

  /**
   * Behavioral rules appended to the tool description (can be overridden).
   * Used to inject mandatory restrictions and usage instructions the LLM must follow.
   */
  getUsageRules(): string[] {
    return []
  }

  /** Generate model names from models configuration */
  getModelNames(): string[] {
    return Object.keys(this.models)
  }

  /** Generate model names excluding read-only models (for write operations) */
  getWritableModelNames(): string[] {
    return Object.keys(this.models).filter((name) => !this.models[name]!.api?.readOnly)
  }

  /**
   * Create a Zod enum or string schema from a list of values.
   * Falls back to z.string() when the list is empty (z.enum requires >= 1 value).
   */
  zodEnum(values: string[]): ZodTypeAny {
    return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()
  }

  /** Validate model exists in configuration */
  validateModel(modelName: string): void {
    if (!this.models[modelName]) {
      const available = this.getModelNames().join(', ')
      throw new Error(`Unknown model: ${modelName}. Available models: ${available}`)
    }
  }

  /** Get model configuration */
  getModelConfig(modelName: string): ModelConfig | undefined {
    return this.models[modelName]
  }

  /** Format error response */
  formatError(error: HttpError): ToolErrorResponse {
    const errorMessage = error.response ? this.formatErrorResponse(error.response) : error.message

    if (this.logger) {
      this.logger.error('Tool execution failed', {
        service: 'mcp-tools',
        tool: this.name,
        error: errorMessage,
        status: error.response?.status,
        stack: error.stack
      })
    }

    return {
      content: [{ type: 'text', text: errorMessage }],
      isError: true
    }
  }

  /**
   * Format an HTTP error response into LLM-optimized text.
   * Delegates to convention for error extraction, then joins with semicolons.
   */
  private formatErrorResponse(response: { status?: number; data?: unknown }): string {
    const convention = defaultConvention
    const errors = convention.parseErrorResponse(response)
    const message =
      errors.length > 0 ? this.truncateString(errors.join('; '), 5000) : 'Unknown error'
    return response.status ? `${message} (${response.status})` : message
  }

  /** Truncate string to maximum length */
  truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str
    return str.substring(0, maxLength) + '...\n[truncated]'
  }

  /** Sanitize response data for display */
  sanitizeResponseData(data: unknown): string {
    return JSON.stringify(data, null, 2)
  }

  /** Format success response */
  formatResponse(
    data: string | Record<string, unknown>,
    { meta }: { meta?: Record<string, unknown> } = {}
  ): ToolSuccessResponse {
    const text = typeof data === 'string' ? data : this.sanitizeResponseData(data)
    const response: ToolSuccessResponse = {
      content: [
        {
          type: 'text',
          text
        }
      ]
    }
    if (meta) response._meta = meta
    return response
  }

  /**
   * Assert the data layer is available (i.e. the tool ran in an
   * authenticated context). Returns the instance for chaining.
   */
  requireDataLayer(): DataLayer {
    if (!this.dataLayer) {
      throw new Error('Not authenticated. Please authenticate first.')
    }
    return this.dataLayer
  }

  /** Fire-and-forget: store operation embedding for retrospective analysis */
  protected storeToolMemory(params: {
    toolName: string
    toolArgs: Record<string, unknown>
    toolOutput?: Record<string, unknown>
    userId?: string
  }): void {
    storeOperation({
      ...params,
      sessionId: this.serverContext.sessionId
    }).catch((err: Error) => {
      if (this.logger) {
        this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
      }
    })
  }

  /**
   * Send an MCP progress notification.
   * No-op if the client didn't request progress tracking (no progressToken).
   */
  protected async sendProgress(params: {
    progress: number
    total?: number
    message?: string
  }): Promise<void> {
    const token = this._extra?._meta?.progressToken
    if (token == null || !this._extra?.sendNotification) return

    await this._extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: token, ...params }
    })
  }

  /** Abort signal from the client request (if available) */
  protected get abortSignal(): AbortSignal | undefined {
    return this._extra?.signal
  }
}
