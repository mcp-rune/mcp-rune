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

import type { AppDefinition, AppRegistry } from '#src/mcp/apps/lib/registry.js'
import { SelectionStore } from '#src/mcp/apps/lib/selection-store.js'
import type {
  ContextKey,
  ToolFlowExtension,
  ToolFlowExtensionContext,
  ToolFlowExtensionMap
} from '#src/mcp/extensions/tool-flow.js'
import type { PromptRegistry } from '#src/mcp/prompts/prompt-registry.js'
import type { ToolRegistry } from '#src/mcp/tools/tool-registry.js'
import { setMcpClientContext } from '#src/runtime/error-tracking.js'
import * as logger from '#src/runtime/logger.js'
import { setSessionContext } from '#src/runtime/tracing.js'

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

interface CreateServerConfig {
  name: string
  version: string
  sessionId: string
  transport: string
  toolRegistry: ToolRegistry
  promptRegistry?: PromptRegistry
  appRegistry?: AppRegistry
  /**
   * Opt-in tool-flow extensions. Applied before app tools are registered on
   * the underlying McpServer; capabilities are validated at boot. See
   * `docs/guides/extensions.md`.
   */
  toolFlowExtensions?: ToolFlowExtensionMap
  getAccessToken: () => Promise<string>
}

/** Create an McpServer with standard handler registration */
export function createServer({
  name,
  version,
  sessionId,
  transport,
  toolRegistry,
  promptRegistry,
  appRegistry,
  toolFlowExtensions,
  getAccessToken
}: CreateServerConfig): McpServer {
  const mcpServer = new McpServer({ name, version })
  const logContext: Record<string, unknown> = { service: name }

  // ============================================================================
  // TOOL-FLOW EXTENSIONS (must run before app tool registration)
  // ============================================================================

  const extraContext: Record<string, unknown> = {}

  if (toolFlowExtensions && Object.keys(toolFlowExtensions).length > 0) {
    if (!appRegistry) {
      throw new Error(
        'createServer: toolFlowExtensions require an appRegistry. ' +
          'Either remove the extensions or provide an AppRegistry.'
      )
    }
    applyToolFlowExtensions(toolFlowExtensions, appRegistry, extraContext, name)
  }

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
    appRegistry.registerTools(mcpServer, { getAccessToken, selectionStore, extraContext })
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
    ;(mcpServer.server.setRequestHandler as any)(
      GetPromptRequestSchema,
      async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
        const { name: promptName, arguments: args } = request.params
        logger.info('GetPromptRequestSchema handler invoked', {
          ...logContext,
          handler: 'GetPromptRequestSchema',
          prompt: promptName
        })
        return promptRegistry.getPrompt(promptName, args)
      }
    )
  }

  // ============================================================================
  // COMPLETION HANDLERS (on underlying server -- custom logic)
  // ============================================================================

  if (CompleteRequestSchema && promptRegistry) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK schema typing requires `any` cast for dynamic handler registration
    ;(mcpServer.server.setRequestHandler as any)(
      CompleteRequestSchema,
      async (request: {
        params: {
          ref?: { type?: string; name?: string }
          argument?: { name?: string; value?: string }
        }
      }) => {
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
      }
    )
  }

  // ============================================================================
  // CLIENT IDENTIFICATION (after MCP handshake completes)
  // ============================================================================

  mcpServer.server.oninitialized = () => {
    const clientVersion = mcpServer.server.getClientVersion()
    const clientCapabilities = mcpServer.server.getClientCapabilities()

    const clientName = clientVersion?.name ?? 'unknown'
    const clientVer = clientVersion?.version ?? 'unknown'

    // Enrich logContext — all tool handlers that spread logContext automatically pick these up
    logContext.clientName = clientName
    logContext.clientVersion = clientVer
    logContext.transport = transport

    logger.info('Client connected', {
      ...logContext,
      sessionId,
      capabilities: {
        sampling: !!clientCapabilities?.sampling,
        roots: !!clientCapabilities?.roots,
        rootsListChanged: !!clientCapabilities?.roots?.listChanged,
        experimental: clientCapabilities?.experimental
          ? Object.keys(clientCapabilities.experimental)
          : []
      }
    })

    setMcpClientContext({ name: clientName, version: clientVer, transport })
    setSessionContext({
      sessionId,
      metadata: { transport, clientName, clientVersion: clientVer }
    })
  }

  return mcpServer
}

/**
 * Validate + apply each tool-flow extension. The context exposes a narrow
 * surface (`registerTool`, `getApp`, `setFormSubmitMode`, `provideContext`)
 * mirroring the `HttpExtensionContext` design — extensions cannot reach the
 * raw `AppRegistry` or `McpServer`.
 */
function applyToolFlowExtensions(
  extensions: ToolFlowExtensionMap,
  appRegistry: AppRegistry,
  extraContext: Record<string, unknown>,
  mcpName: string
): void {
  // Tracks which extension contributed each context key name, for collision
  // diagnostics. Mirrors `_toolOwners` / `_mixinMethodOwners` on ToolRegistry.
  const contextKeyOwners = new Map<string, string>()

  for (const [name, extension] of Object.entries(extensions) as Array<
    [string, ToolFlowExtension]
  >) {
    if (extension.requires?.includes('apps') && !appRegistry) {
      throw new Error(
        `Tool-flow extension "${name}" requires apps, but no AppRegistry is configured.`
      )
    }

    const ctx: ToolFlowExtensionContext = {
      name,
      mcpName,
      registerTool(app: AppDefinition): void {
        appRegistry.registerApp(app)
      },
      getApp(toolName: string): AppDefinition | undefined {
        return appRegistry.getApp(toolName)
      },
      setFormSubmitMode(mode): void {
        appRegistry.setFormSubmitMode(mode)
      },
      provideContext<T>(key: ContextKey<T>, value: T): void {
        const existingOwner = contextKeyOwners.get(key.name)
        if (existingOwner !== undefined) {
          throw new Error(
            `ToolFlowExtension "${name}" attempted to provide context key "${key.name}", ` +
              `which is already provided by "${existingOwner}". Context key names must be ` +
              `globally unique across all tool-flow extensions.`
          )
        }
        contextKeyOwners.set(key.name, name)
        extraContext[key.name] = value
      },
      logger
    }

    const result = extension.register(ctx)

    // register() may return a Promise; surface failures as a boot-time throw so
    // misconfiguration cannot quietly leave the server in a half-applied state.
    if (result instanceof Promise) {
      result.catch((err: Error) => {
        logger.error(`Tool-flow extension "${name}" failed to register`, {
          service: mcpName,
          extensionName: name,
          error: err.message,
          stack: err.stack
        })
        process.exit(1)
      })
    }

    logger.info(`Tool-flow extension "${name}" registered`, {
      service: mcpName,
      extensionName: name
    })
  }
}
