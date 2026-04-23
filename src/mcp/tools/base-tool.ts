import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import { z } from 'zod'
export type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { ApiClient, RequestOptions } from '#src/mcp/search/types.js'
import type { ModelService } from '#src/mcp/services/model-service.js'

import type { AssociationConfig, BaseConvention } from '../api-conventions/base-convention.js'
import type { ToolCategory } from './categories.js'
import { getCategoryConfig, TOOL_CATEGORIES } from './categories.js'

// ============================================================================
// Types
// ============================================================================

export type { ApiClient, RequestOptions }

/** Logger interface expected by tools */
export interface ToolLogger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

/** Server context for multi-product disambiguation */
export interface ServerContext {
  name?: string
  description?: string
  productLines?: string[]
}

/** Prompt registry interface for dynamic descriptions */
export interface PromptRegistry {
  getRequiredPromptRestrictions?(): string | null
  getBulkRecommendations?(): string | null
  getPromptRequiredModels?(): string[]
  getPromptNameByModel?(model: string): string | null
  [key: string]: unknown
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
  endpoint: string
  attributes?: Record<string, unknown>
  description?: string
  api?: {
    convention?: BaseConvention
    readOnly?: boolean
    nested?: {
      parent?: string | string[]
      nestedOnly?: boolean
      pathTemplate?: string
      parentKey?: string
    }
  }
  search?: {
    lookup?: { endpoint?: string; fields: string[]; queryParam?: string }
    query?: Record<string, unknown>
    filters?: Record<string, FilterSchema>
  } | null
  associations?: AssociationConfig & {
    custom?: Record<string, Record<string, unknown>>
  }
  [key: string]: unknown
}

/** Models registry: model name to model config */
export type ModelsRegistry = Record<string, ModelConfig>

/** Dependencies injected into tool constructors */
export interface ToolDependencies {
  apiClient?: ApiClient
  modelService?: ModelService
  logger?: ToolLogger
  models?: ModelsRegistry
  promptRegistry?: PromptRegistry
  serverContext?: ServerContext
  domainRegistry?: DomainRegistry
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
 * All tools extend this class (directly or via server-specific base) and provide:
 * - name: Tool name
 * - baseDescription: Base tool description (description getter adds sections)
 * - inputSchema: Zod raw shape for tool parameters (e.g., { model: z.string() })
 * - execute(args): Implementation logic
 *
 * Server-specific bases (e.g., EngineerBaseTool) should extend this and:
 * - Override getDisambiguationNote() for multi-product environments
 * - Add server-specific helpers
 *
 * Tool categories determine auth requirements:
 * - STRATEGY: No auth required (works with prompt strategies)
 * - CRUD: Auth required (API operations)
 * - AUTOCOMPLETE: Auth required (field suggestions)
 * - CUSTOM: Default auth required (server-specific)
 */
export class BaseTool {
  /**
   * Tool category - determines auth requirements and registry behavior.
   * Override in subclasses to specify category.
   */
  static get category(): ToolCategory {
    return TOOL_CATEGORIES.DATA // Default to requiring auth
  }

  /**
   * Whether this tool requires authentication.
   * Derived from category but can be overridden in subclasses.
   */
  static get requiresAuth(): boolean {
    const config = getCategoryConfig(this.category)
    return config.requiresAuth
  }

  apiClient: ApiClient | undefined
  modelService: ModelService | undefined
  logger: ToolLogger | undefined
  models: ModelsRegistry
  promptRegistry: PromptRegistry | undefined
  serverContext: ServerContext
  domainRegistry: DomainRegistry | undefined

  constructor(dependencies: ToolDependencies = {}) {
    this.apiClient = dependencies.apiClient
    this.modelService = dependencies.modelService
    this.logger = dependencies.logger
    this.models = dependencies.models ?? {}
    this.promptRegistry = dependencies.promptRegistry
    this.serverContext = dependencies.serverContext ?? {}
    this.domainRegistry = dependencies.domainRegistry
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

  /** MCP tool annotations (override in subclasses to customize) */
  get annotations(): ToolAnnotations {
    const config = getCategoryConfig((this.constructor as typeof BaseTool).category)
    return { ...config.defaultAnnotations }
  }

  /** Execute tool logic (override in subclasses) */
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    throw new Error('Tool must implement execute method')
  }

  /**
   * Full tool description with usage rules and disambiguation.
   * Combines baseDescription + usageRules + disambiguationNote.
   */
  get description(): string {
    let desc = this.baseDescription

    // Add usage rules if needed
    const rules = this.getUsageRules()
    if (rules.length > 0) {
      desc += '\n\n' + rules.join('\n\n')
    }

    // Add disambiguation note
    desc += '\n' + this.getDisambiguationNote()

    return desc
  }

  /**
   * Behavioral rules appended to the tool description (can be overridden).
   * Used to inject mandatory restrictions and usage instructions the LLM must follow.
   */
  getUsageRules(): string[] {
    return []
  }

  /**
   * Disambiguation note for multi-product environments.
   * Generates from serverContext when available, otherwise returns empty string.
   * Can be overridden in subclasses for custom behavior.
   */
  getDisambiguationNote(): string {
    const { name, description, productLines } = this.serverContext
    if (!name) return ''
    let note = `\nIMPORTANT: This tool operates on ${name} specifically.`
    if (description) note += `\n${name} is the ${description}.`
    note +=
      '\nIf the user has not specified which application to use, confirm they intend to use this application before proceeding.'
    if (productLines && productLines.length > 1) {
      note += `\nMultiple product lines may be available (${productLines.join(', ')}) - each is a separate system.`
    }
    return note
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
    const errorMessage = error.response?.data
      ? typeof error.response.data === 'string'
        ? this.truncateString(error.response.data, 5000)
        : JSON.stringify(error.response.data, null, 2)
      : error.message

    if (this.logger) {
      this.logger.error('Tool execution failed', {
        service: 'mcp-tools',
        tool: this.name,
        error: errorMessage,
        status: error.response?.status ?? 'N/A',
        stack: error.stack
      })
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}\nStatus: ${error.response?.status ?? 'N/A'}`
        }
      ],
      isError: true
    }
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

  /** Check if API client is required and available */
  requireApiClient(): void {
    if (!this.apiClient) {
      throw new Error('Not authenticated. Please authenticate first.')
    }
  }
}
