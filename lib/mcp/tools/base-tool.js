import { z } from 'zod'
import { TOOL_CATEGORIES, getCategoryConfig } from './categories.js'

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
   * Tool category - determines auth requirements and registry behavior
   * Override in subclasses to specify category
   * @returns {string} One of TOOL_CATEGORIES values
   */
  static get category() {
    return TOOL_CATEGORIES.CRUD // Default to requiring auth
  }

  /**
   * Whether this tool requires authentication
   * Derived from category but can be overridden in subclasses
   * @returns {boolean}
   */
  static get requiresAuth() {
    const config = getCategoryConfig(this.category)
    return config.requiresAuth
  }
  /**
   * Constructor for dependency injection
   * @param {Object} dependencies - Tool dependencies
   * @param {Object} [dependencies.apiClient] - API client instance
   * @param {Object} [dependencies.logger] - Logger instance
   * @param {Object} [dependencies.models] - Models configuration
   * @param {Object} [dependencies.promptRegistry] - Prompt registry for dynamic descriptions
   * @param {Object} [dependencies.serverContext] - Server context for disambiguation
   * @param {string} [dependencies.serverContext.name] - Server name (e.g., 'Engineer')
   * @param {string} [dependencies.serverContext.description] - Server description
   * @param {string[]} [dependencies.serverContext.productLines] - Available product lines
   * @param {Object} [dependencies.domainRegistry] - Domain intelligence registry
   */
  constructor(dependencies = {}) {
    this.apiClient = dependencies.apiClient
    this.logger = dependencies.logger
    this.models = dependencies.models || {}
    this.promptRegistry = dependencies.promptRegistry
    this.serverContext = dependencies.serverContext || {}
    this.domainRegistry = dependencies.domainRegistry
  }

  /**
   * Get tool name (to be overridden by subclasses)
   * @returns {string} Tool name
   */
  get name() {
    throw new Error('Tool must implement name getter')
  }

  /**
   * Get base description (to be overridden by subclasses)
   * @returns {string} Base description without sections
   */
  get baseDescription() {
    throw new Error('Tool must implement baseDescription getter')
  }

  /**
   * Get input schema (to be overridden by subclasses)
   * @returns {Object} Zod raw shape for tool parameters (e.g., { model: z.string() })
   */
  get inputSchema() {
    throw new Error('Tool must implement inputSchema getter')
  }

  /**
   * Execute tool logic (to be overridden by subclasses)
   * @param {Object} _args - Tool arguments
   * @returns {Promise<Object>} Tool response
   */
  async execute(_args) {
    throw new Error('Tool must implement execute method')
  }

  /**
   * Get full tool description with usage rules and disambiguation
   * Combines baseDescription + usageRules + disambiguationNote
   * @returns {string} Complete tool description
   */
  get description() {
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
   * Get behavioral rules appended to the tool description (can be overridden)
   * Used to inject mandatory restrictions and usage instructions the LLM must follow.
   * @returns {string[]} Array of usage rules
   */
  getUsageRules() {
    return []
  }

  /**
   * Get disambiguation note for multi-product environments.
   * Generates from serverContext when available, otherwise returns empty string.
   * Can be overridden in subclasses for custom behavior.
   * @returns {string} Disambiguation note
   */
  getDisambiguationNote() {
    const { name, description, productLines } = this.serverContext
    if (!name) return ''
    let note = `\nIMPORTANT: This tool operates on ${name} specifically.`
    if (description) note += `\n${name} is the ${description}.`
    note +=
      '\nIf the user has not specified which application to use, confirm they intend to use this application before proceeding.'
    if (productLines?.length > 1) {
      note += `\nMultiple product lines may be available (${productLines.join(', ')}) - each is a separate system.`
    }
    return note
  }

  /**
   * Generate model names from models configuration
   * @returns {string[]} Array of model names
   */
  getModelNames() {
    return Object.keys(this.models)
  }

  /**
   * Generate model names excluding read-only models (for write operations)
   * @returns {string[]} Array of writable model names
   */
  getWritableModelNames() {
    return Object.keys(this.models).filter((name) => !this.models[name].api?.readOnly)
  }

  /**
   * Create a Zod enum or string schema from a list of values.
   * Falls back to z.string() when the list is empty (z.enum requires ≥1 value).
   * @param {string[]} values - Enum values
   * @returns {import('zod').ZodType} Zod schema
   */
  zodEnum(values) {
    return values.length > 0 ? z.enum(values) : z.string()
  }

  /**
   * Validate model exists in configuration
   * @param {string} modelName - Model name to validate
   * @throws {Error} If model doesn't exist
   */
  validateModel(modelName) {
    if (!this.models[modelName]) {
      const available = this.getModelNames().join(', ')
      throw new Error(`Unknown model: ${modelName}. Available models: ${available}`)
    }
  }

  /**
   * Get model configuration
   * @param {string} modelName - Model name
   * @returns {Object} Model configuration
   */
  getModelConfig(modelName) {
    return this.models[modelName]
  }

  /**
   * Format error response
   * @param {Error} error - Error object
   * @returns {Object} Formatted error response
   */
  formatError(error) {
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
        status: error.response?.status || 'N/A',
        stack: error.stack
      })
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}\nStatus: ${error.response?.status || 'N/A'}`
        }
      ],
      isError: true
    }
  }

  /**
   * Truncate string to maximum length
   * @param {string} str - String to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated string
   */
  truncateString(str, maxLength) {
    if (str.length <= maxLength) return str
    return str.substring(0, maxLength) + '...\n[truncated]'
  }

  /**
   * Sanitize response data for display
   * @param {any} data - Response data
   * @returns {string} Sanitized JSON string
   */
  sanitizeResponseData(data) {
    return JSON.stringify(data, null, 2)
  }

  /**
   * Format success response
   * @param {string|Object} data - Response data
   * @param {Object} [options] - Optional response metadata
   * @param {Object} [options.meta] - MCP _meta field (client-side hints, e.g., context lifecycle)
   * @returns {Object} Formatted response
   */
  formatResponse(data, { meta } = {}) {
    const text = typeof data === 'string' ? data : this.sanitizeResponseData(data)
    const response = {
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
   * Check if API client is required and available
   * @throws {Error} If API client is required but not available
   */
  requireApiClient() {
    if (!this.apiClient) {
      throw new Error('Not authenticated. Please authenticate first.')
    }
  }
}
