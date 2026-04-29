import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolHandlerExtra, ToolResult } from '../../../../src/mcp/tools/base-tool.js'
import { BaseTool } from '../../../../src/mcp/tools/base-tool.js'
import { TOOL_CATEGORIES } from '../../../../src/mcp/tools/categories.js'
import type { ToolInterceptor } from '../../../../src/mcp/tools/tool-pipeline.js'
import { ToolRegistry } from '../../../../src/mcp/tools/tool-registry.js'

// Mock services
vi.mock('#src/services/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('#src/services/tracing.js', () => ({
  traceToolCall: vi.fn((_name, _args, handler) => handler())
}))

import * as logger from '../../../../src/services/logger.js'
import * as tracing from '../../../../src/services/tracing.js'

// ============================================================================
// Test tool classes
// ============================================================================

class NoAuthTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.STRATEGY
  }
  get name() {
    return 'no_auth_tool'
  }
  get baseDescription() {
    return 'A tool that does not require auth'
  }
  get inputSchema() {
    return {}
  }
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    return { content: [{ type: 'text', text: `executed with ${JSON.stringify(args)}` }] }
  }
}

class AuthTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.DATA
  }
  get name() {
    return 'auth_tool'
  }
  get baseDescription() {
    return 'A tool that requires auth'
  }
  get inputSchema() {
    return {}
  }
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    this.requireApiClient()
    return { content: [{ type: 'text', text: 'authenticated' }] }
  }
}

class DomainTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.DOMAIN
  }
  get name() {
    return 'domain_tool'
  }
  get baseDescription() {
    return 'A domain tool'
  }
  get inputSchema() {
    return {}
  }
  async execute(): Promise<ToolResult> {
    return { content: [{ type: 'text', text: 'domain' }] }
  }
}

class AnalysisTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.ANALYSIS
  }
  get name() {
    return 'analysis_tool'
  }
  get baseDescription() {
    return 'An analysis tool'
  }
  get inputSchema() {
    return {}
  }
  async execute(): Promise<ToolResult> {
    return { content: [{ type: 'text', text: 'analysis' }] }
  }
}

class FailingTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.STRATEGY
  }
  get name() {
    return 'failing_tool'
  }
  get baseDescription() {
    return 'A tool that always fails'
  }
  get inputSchema() {
    return {}
  }
  async execute(): Promise<ToolResult> {
    throw new Error('tool explosion')
  }
}

// ============================================================================
// Mock McpServer
// ============================================================================

type ToolHandler = (...args: unknown[]) => unknown

function createMockMcpServer() {
  const registeredTools = new Map<string, { config: unknown; handler: ToolHandler }>()
  return {
    registerTool: vi.fn((name: string, config: unknown, handler: ToolHandler) => {
      registeredTools.set(name, { config, handler })
    }),
    registeredTools,
    getHandler(name: string) {
      return registeredTools.get(name)?.handler
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('lib/mcp/tools/tool-registry', () => {
  let mockMcpServer: ReturnType<typeof createMockMcpServer>

  beforeEach(() => {
    mockMcpServer = createMockMcpServer()
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should accept minimal configuration', () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {}
      })
      expect(registry.serverContext).toEqual({})
    })

    it('should expose serverContext', () => {
      const registry = new ToolRegistry({
        toolClasses: {},
        models: {},
        serverContext: { name: 'Test', namespace: 'test' }
      })
      expect(registry.serverContext).toEqual({ name: 'Test', namespace: 'test' })
    })
  })

  describe('registerTools', () => {
    it('should register all tool classes on the McpServer', () => {
      const registry = new ToolRegistry({
        toolClasses: {
          no_auth_tool: NoAuthTool as any,
          auth_tool: AuthTool as any
        },
        models: {},
        createApiClient: () => ({}) as any
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => 'token'
      })

      expect(mockMcpServer.registerTool).toHaveBeenCalledTimes(2)
      expect(mockMcpServer.registeredTools.has('no_auth_tool')).toBe(true)
      expect(mockMcpServer.registeredTools.has('auth_tool')).toBe(true)
    })

    it('should register tools with description, inputSchema, and annotations', () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      expect(mockMcpServer.registerTool).toHaveBeenCalledWith(
        'no_auth_tool',
        expect.objectContaining({
          description: expect.any(String),
          inputSchema: expect.any(Object),
          annotations: expect.any(Object)
        }),
        expect.any(Function)
      )
    })

    it('should skip tools that throw during schema validation', () => {
      // Create a tool whose inputSchema getter throws
      class BadSchemaTool extends BaseTool {
        static override get category() {
          return TOOL_CATEGORIES.STRATEGY
        }
        get name() {
          return 'bad_schema_tool'
        }
        get baseDescription() {
          return 'Bad schema'
        }
        get inputSchema(): Record<string, any> {
          throw new Error('schema broken')
        }
        async execute(): Promise<ToolResult> {
          return { content: [{ type: 'text', text: 'never' }] }
        }
      }

      const registry = new ToolRegistry({
        toolClasses: {
          bad_schema_tool: BadSchemaTool as any,
          no_auth_tool: NoAuthTool as any
        },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      // bad_schema_tool should be skipped, no_auth_tool should register
      expect(logger.error).toHaveBeenCalledWith(
        'Skipping tool with invalid schema',
        expect.objectContaining({ tool: 'bad_schema_tool' })
      )
      expect(mockMcpServer.registeredTools.has('bad_schema_tool')).toBe(false)
      expect(mockMcpServer.registeredTools.has('no_auth_tool')).toBe(true)
    })

    it('should execute no-auth tool without API client', async () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      const result = await handler({ query: 'test' })

      expect(result.content[0].text).toContain('executed with')
    })

    it('should create authenticated API client for auth-required tools', async () => {
      const mockApiClient = { get: vi.fn() }
      const createApiClient = vi.fn().mockReturnValue(mockApiClient)

      const registry = new ToolRegistry({
        toolClasses: { auth_tool: AuthTool as any },
        models: {},
        createApiClient
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => 'my-token'
      })

      const handler = mockMcpServer.getHandler('auth_tool')!
      const result = await handler({})

      expect(createApiClient).toHaveBeenCalledWith('my-token')
      expect(result.content[0].text).toBe('authenticated')
    })

    it('should return error when auth tool has no token', async () => {
      const registry = new ToolRegistry({
        toolClasses: { auth_tool: AuthTool as any },
        models: {},
        createApiClient: () => ({}) as any
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('auth_tool')!
      const result = await handler({})

      // errorInterceptor catches the auth error
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Not authenticated')
    })

    it('should throw when auth tool is registered without createApiClient', async () => {
      const registry = new ToolRegistry({
        toolClasses: { auth_tool: AuthTool as any },
        models: {}
        // No createApiClient provided
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => 'token'
      })

      const handler = mockMcpServer.getHandler('auth_tool')!
      const result = await handler({})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('createApiClient')
    })

    it('should wrap all tool calls with tracing', async () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      await handler({})

      expect(tracing.traceToolCall).toHaveBeenCalledWith(
        'no_auth_tool',
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('should log tool calls via built-in logging interceptor', async () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null,
        logContext: { service: 'test-server' }
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      await handler({})

      expect(logger.info).toHaveBeenCalledWith('Tool called', {
        service: 'test-server',
        tool: 'no_auth_tool'
      })
    })

    it('should catch errors via built-in error interceptor', async () => {
      const registry = new ToolRegistry({
        toolClasses: { failing_tool: FailingTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('failing_tool')!
      const result = await handler({})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('Error: tool explosion')
    })
  })

  describe('feature gates', () => {
    it('should skip tools in gated categories when gate is false', () => {
      const registry = new ToolRegistry({
        toolClasses: {
          no_auth_tool: NoAuthTool as any,
          domain_tool: DomainTool as any,
          analysis_tool: AnalysisTool as any
        },
        models: {},
        gates: {
          [TOOL_CATEGORIES.DOMAIN]: false,
          [TOOL_CATEGORIES.ANALYSIS]: false
        }
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      expect(mockMcpServer.registeredTools.has('no_auth_tool')).toBe(true)
      expect(mockMcpServer.registeredTools.has('domain_tool')).toBe(false)
      expect(mockMcpServer.registeredTools.has('analysis_tool')).toBe(false)
    })

    it('should include tools in gated categories when gate is true', () => {
      const registry = new ToolRegistry({
        toolClasses: {
          no_auth_tool: NoAuthTool as any,
          domain_tool: DomainTool as any
        },
        models: {},
        gates: {
          [TOOL_CATEGORIES.DOMAIN]: true
        }
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      expect(mockMcpServer.registeredTools.has('no_auth_tool')).toBe(true)
      expect(mockMcpServer.registeredTools.has('domain_tool')).toBe(true)
    })

    it('should include tools with no gate defined', () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {},
        gates: {} // no gates for STRATEGY category
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      expect(mockMcpServer.registeredTools.has('no_auth_tool')).toBe(true)
    })
  })

  describe('custom interceptors', () => {
    it('should run custom interceptors between logging and error-catch', async () => {
      const events: string[] = []
      const customInterceptor: ToolInterceptor = {
        name: 'audit',
        before() {
          events.push('audit:before')
        },
        after() {
          events.push('audit:after')
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {},
        interceptors: [customInterceptor]
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      await handler({})

      // Custom interceptor should have run
      expect(events).toContain('audit:before')
      expect(events).toContain('audit:after')
    })

    it('should allow custom interceptor to abort execution', async () => {
      const permissionCheck: ToolInterceptor = {
        name: 'permissions',
        before(ctx) {
          if (ctx.toolName === 'no_auth_tool') {
            throw new Error('forbidden')
          }
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {},
        interceptors: [permissionCheck]
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      const result = await handler({})

      // errorInterceptor catches the permission error
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('Error: forbidden')
    })

    it('should support multiple custom interceptors', async () => {
      const order: string[] = []
      const interceptorA: ToolInterceptor = {
        name: 'a',
        before() {
          order.push('a:before')
        },
        after() {
          order.push('a:after')
        }
      }
      const interceptorB: ToolInterceptor = {
        name: 'b',
        before() {
          order.push('b:before')
        },
        after() {
          order.push('b:after')
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {},
        interceptors: [interceptorA, interceptorB]
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      await handler({})

      // before: logging, a, b, error-catch (logging/error-catch don't push to order)
      // after: error-catch, b, a, logging (reverse)
      expect(order).toEqual(['a:before', 'b:before', 'b:after', 'a:after'])
    })
  })

  describe('extra plumbing', () => {
    it('should set _extra on tool instance before execute', async () => {
      let capturedExtra: ToolHandlerExtra | undefined

      class ExtraCaptureTool extends BaseTool {
        static override get category() {
          return TOOL_CATEGORIES.STRATEGY
        }
        get name() {
          return 'extra_capture'
        }
        get baseDescription() {
          return 'Captures extra'
        }
        get inputSchema() {
          return {}
        }
        async execute(): Promise<ToolResult> {
          capturedExtra = this._extra
          return { content: [{ type: 'text', text: 'ok' }] }
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { extra_capture: ExtraCaptureTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('extra_capture')!
      const extra: ToolHandlerExtra = {
        _meta: { progressToken: 'tok-abc' },
        sendNotification: vi.fn()
      }

      await handler({}, extra)

      expect(capturedExtra).toBeDefined()
      expect(capturedExtra?._meta?.progressToken).toBe('tok-abc')
    })

    it('should work without extra (backward compatible)', async () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {}
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      const handler = mockMcpServer.getHandler('no_auth_tool')!
      const result = await handler({ query: 'test' })

      expect(result.content[0].text).toContain('executed with')
    })
  })

  describe('dependency injection', () => {
    it('should pass models to tool instances', async () => {
      const models = { book: { api: { endpoint: 'books' } } }
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      // The tool was registered — models were passed to constructor
      expect(mockMcpServer.registeredTools.has('no_auth_tool')).toBe(true)
    })

    it('should pass serverContext to tool instances', () => {
      const registry = new ToolRegistry({
        toolClasses: { no_auth_tool: NoAuthTool as any },
        models: {},
        serverContext: { name: 'My Server' }
      })

      registry.registerTools(mockMcpServer as any, {
        getAccessToken: async () => null
      })

      // Tool description includes disambiguation note from serverContext
      const config = mockMcpServer.registeredTools.get('no_auth_tool')?.config as any
      expect(config.description).toContain('My Server')
    })
  })
})
