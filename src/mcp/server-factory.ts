/**
 * MCP Server Factory
 *
 * Creates configured McpServer instances with standard handler registration.
 * Used by both stdio and HTTP transports to ensure consistent behavior.
 *
 * Uses the high-level McpServer class from @modelcontextprotocol/sdk which:
 * - Auto-manages capabilities based on registered tools/prompts/resources
 * - Validates tool inputs via Zod schemas
 * - Provides registerTool/prompt/resource API
 *
 * Custom handlers (completions) are registered on the
 * underlying server via mcpServer.server.
 *
 * MCP Apps (tools + resources) are registered via @modelcontextprotocol/ext-apps
 * helpers which use the high-level McpServer API for native capability management.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as logger from '#src/services/logger.js'
import { SelectionStore } from '#src/mcp/apps/selection-store.js'
import { FormDataStore } from '#src/mcp/apps/form-data-store.js'

// Dynamic import for request schemas needed for custom handlers
let CompleteRequestSchema: unknown = null
let ListPromptsRequestSchema: unknown = null
let GetPromptRequestSchema: unknown = null
try {
  const types = await import('@modelcontextprotocol/sdk/types.js')
  CompleteRequestSchema = types.CompleteRequestSchema
  ListPromptsRequestSchema = types.ListPromptsRequestSchema
  GetPromptRequestSchema = types.GetPromptRequestSchema
} catch {
  logger.warn('Some request schemas not available in SDK', { service: 'mcp-server' })
}

/** Minimal interface for the tool registry */
interface ToolRegistry {
  serverContext: Record<string, unknown>
  registerTools(mcpServer: McpServer, options: { getAccessToken: () => Promise<string | null | undefined>; logContext: Record<string, unknown> }): void
}

/** Minimal interface for the prompt registry */
interface PromptRegistry {
  getDefinitions(): unknown[]
  getPrompt(name: string, args?: Record<string, unknown>): unknown
  getPromptClass(name: string): PromptClass | null
  getStats?(): Record<string, unknown>
}

/** A prompt class with optional field definitions for completion */
interface PromptClass {
  fieldDefinitions?: Record<string, FieldDefinition>
}

interface FieldDefinition {
  completion?: { enabled: boolean }
  enumValues?: string[]
}

/** Minimal interface for the app registry */
interface AppRegistry {
  getToolNames(): string[]
  registerTools(mcpServer: McpServer, options: { getAccessToken: () => Promise<string | null | undefined>; selectionStore: SelectionStore; formDataStore: FormDataStore }): void
  registerResources(mcpServer: McpServer): void
}

interface CreateServerConfig {
  name: string
  version: string
  toolRegistry: ToolRegistry
  promptRegistry?: PromptRegistry
  appRegistry?: AppRegistry
  getAccessToken: () => Promise<string | null | undefined>
}

/** Create an McpServer with standard handler registration */
export function createServer({
  name,
  version,
  toolRegistry,
  promptRegistry,
  appRegistry,
  getAccessToken
}: CreateServerConfig): McpServer {
  const mcpServer = new McpServer({ name, version })
  const logContext = { service: name }

  // ============================================================================
  // TOOL REGISTRATION
  // ============================================================================

  // Inject app tool names into server context for dynamic exclusion in workflow renderer
  if (appRegistry) {
    toolRegistry.serverContext.appToolNames = appRegistry.getToolNames()
  }

  toolRegistry.registerTools(mcpServer, {
    getAccessToken,
    logContext
  })

  // ============================================================================
  // MCP APPS (tools + resources via @modelcontextprotocol/ext-apps)
  // ============================================================================

  if (appRegistry) {
    const selectionStore = new SelectionStore()
    const formDataStore = new FormDataStore()
    appRegistry.registerTools(mcpServer, { getAccessToken, selectionStore, formDataStore })
    appRegistry.registerResources(mcpServer)
  }

  // ============================================================================
  // PROMPT HANDLERS (on underlying server -- needs custom list augmentation)
  // ============================================================================

  if (promptRegistry && ListPromptsRequestSchema && GetPromptRequestSchema) {
    // McpServer auto-manages capabilities based on its high-level API (.prompt(), .tool(), etc.)
    // Since we register prompt/completion handlers on the underlying server directly,
    // we must explicitly declare these capabilities before setting handlers.
    mcpServer.server.registerCapabilities({
      prompts: {},
      completions: {}
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK schema typing requires `any` cast for dynamic handler registration
    ;(mcpServer.server.setRequestHandler as any)(ListPromptsRequestSchema, async () => {
      const prompts = promptRegistry.getDefinitions()
      logger.info('ListPromptsRequestSchema handler invoked', {
        ...logContext,
        handler: 'ListPromptsRequestSchema',
        promptCount: prompts.length
      })
      return { prompts }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK schema typing requires `any` cast for dynamic handler registration
    ;(mcpServer.server.setRequestHandler as any)(GetPromptRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const { name: promptName, arguments: args } = request.params
      logger.info('GetPromptRequestSchema handler invoked', {
        ...logContext,
        handler: 'GetPromptRequestSchema',
        prompt: promptName
      })
      return promptRegistry.getPrompt(promptName, args)
    })
  }

  // ============================================================================
  // COMPLETION HANDLERS (on underlying server -- custom logic)
  // ============================================================================

  if (CompleteRequestSchema && promptRegistry) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK schema typing requires `any` cast for dynamic handler registration
    ;(mcpServer.server.setRequestHandler as any)(CompleteRequestSchema, async (request: { params: { ref?: { type?: string; name?: string }; argument?: { name?: string; value?: string } } }) => {
      const { ref, argument } = request.params

      logger.info('CompleteRequestSchema handler invoked', {
        ...logContext,
        handler: 'CompleteRequestSchema',
        refType: ref?.type,
        refName: ref?.name,
        argumentName: argument?.name
      })

      // Only handle prompt references
      if (ref?.type !== 'ref/prompt') {
        return { completion: { values: [], hasMore: false } }
      }

      const promptClass = promptRegistry.getPromptClass(ref.name!)
      if (!promptClass) {
        return { completion: { values: [], hasMore: false } }
      }

      const fieldName = argument?.name
      const fieldDef = fieldName ? promptClass.fieldDefinitions?.[fieldName] : undefined

      if (!fieldDef?.completion?.enabled) {
        return { completion: { values: [], hasMore: false } }
      }

      // Handle enum-based completion
      if (fieldDef.enumValues && Array.isArray(fieldDef.enumValues)) {
        const query = (argument?.value || '').toLowerCase()
        const filtered = fieldDef.enumValues.filter((v) => v.toLowerCase().includes(query))
        return {
          completion: { values: filtered, total: filtered.length, hasMore: false }
        }
      }

      return { completion: { values: [], hasMore: false } }
    })
  }

  return mcpServer
}
