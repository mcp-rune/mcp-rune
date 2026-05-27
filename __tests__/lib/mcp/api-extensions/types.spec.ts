/**
 * ApiExtension mechanism tests
 *
 * Verifies how ToolRegistry registers ApiExtensions: capability validation,
 * tool-name collision detection (with core tools and across extensions),
 * tool contribution surfacing in the registry, and ModelService mixin
 * methods becoming callable on the instance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiExtension, ApiExtensionContext } from '../../../../src/mcp/api-extensions/types.js'
import type { ToolResult } from '../../../../src/mcp/tools/base-tool.js'
import { BaseTool } from '../../../../src/mcp/tools/base-tool.js'
import { TOOL_CATEGORIES } from '../../../../src/mcp/tools/categories.js'
import { ToolRegistry } from '../../../../src/mcp/tools/tool-registry.js'

vi.mock('#src/services/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('#src/services/tracing.js', () => ({
  traceToolCall: vi.fn((_name, _args, handler) => handler())
}))

vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn(() => Promise.resolve())
}))

// --- Test doubles ---

class CoreTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.STRATEGY
  }
  get name() {
    return 'core_tool'
  }
  get baseDescription() {
    return 'core'
  }
  get inputSchema() {
    return {}
  }
  async execute(): Promise<ToolResult> {
    return { content: [{ type: 'text', text: 'core' }] }
  }
}

class ContributedTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.STRATEGY
  }
  get name() {
    return 'contributed_tool'
  }
  get baseDescription() {
    return 'contributed'
  }
  get inputSchema() {
    return {}
  }
  async execute(): Promise<ToolResult> {
    return { content: [{ type: 'text', text: 'contributed' }] }
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
    return 'auth'
  }
  get inputSchema() {
    return {}
  }
  async execute(): Promise<ToolResult> {
    const service = this.requireModelService()
    const result = (service as unknown as { ping(): string }).ping()
    return { content: [{ type: 'text', text: result }] }
  }
}

const noopApiClient = {
  baseUrl: 'https://api.test',
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn()
}

// --- Tests ---

describe('lib/mcp/api-extensions — ApiExtension mechanism', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registration ctx', () => {
    it('invokes register() once per extension with the registration key as ctx.name', () => {
      const register = vi.fn()
      new ToolRegistry({
        toolClasses: {},
        models: {},
        apiExtensions: {
          foo: { register }
        }
      })

      expect(register).toHaveBeenCalledTimes(1)
      const ctx = register.mock.calls[0]![0] as ApiExtensionContext
      expect(ctx.name).toBe('foo')
      expect(typeof ctx.registerTool).toBe('function')
      expect(typeof ctx.registerModelServiceMixin).toBe('function')
    })

    it('passes the models registry and server context to ctx', () => {
      const models = { book: { api: { endpoint: 'books' } } }
      const serverContext = { name: 'Test Server' }
      const register = vi.fn()

      new ToolRegistry({
        toolClasses: {},
        models,
        serverContext,
        apiExtensions: { ext: { register } }
      })

      const ctx = register.mock.calls[0]![0] as ApiExtensionContext
      expect(ctx.models).toBe(models)
      expect(ctx.serverContext).toEqual(serverContext)
    })

    it('registers extensions in object insertion order', () => {
      const calls: string[] = []
      const make = (label: string): ApiExtension => ({
        register: () => {
          calls.push(label)
        }
      })

      new ToolRegistry({
        toolClasses: {},
        models: {},
        apiExtensions: {
          first: make('first'),
          second: make('second'),
          third: make('third')
        }
      })

      expect(calls).toEqual(['first', 'second', 'third'])
    })
  })

  describe('capability validation', () => {
    it('throws at boot when an extension requires an unknown capability', () => {
      const ext: ApiExtension = {
        // `requires` type is `never`; cast to exercise the runtime guard.
        requires: ['nonexistent' as never],
        register: vi.fn()
      }

      expect(
        () =>
          new ToolRegistry({
            toolClasses: {},
            models: {},
            apiExtensions: { ext }
          })
      ).toThrow(/ApiExtension "ext" requires capability "nonexistent"/)
    })

    it('skips capability check when requires is empty or omitted', () => {
      const register = vi.fn()
      expect(
        () =>
          new ToolRegistry({
            toolClasses: {},
            models: {},
            apiExtensions: {
              a: { register },
              b: { requires: [], register: vi.fn() }
            }
          })
      ).not.toThrow()
      expect(register).toHaveBeenCalled()
    })
  })

  describe('tool contribution', () => {
    it('makes contributed tools available to registerTools()', () => {
      const ext: ApiExtension = {
        register(ctx) {
          ctx.registerTool('contributed_tool', ContributedTool)
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { core_tool: CoreTool },
        models: {},
        apiExtensions: { ext }
      })

      const tools: string[] = []
      const mockServer = {
        registerTool: (name: string) => {
          tools.push(name)
        }
      } as unknown as Parameters<ToolRegistry['registerTools']>[0]

      registry.registerTools(mockServer, {
        getAccessToken: async () => 'token'
      })

      expect(tools).toContain('core_tool')
      expect(tools).toContain('contributed_tool')
    })

    it('throws at boot when an extension contributes a tool that collides with a core tool', () => {
      const ext: ApiExtension = {
        register(ctx) {
          ctx.registerTool('core_tool', ContributedTool)
        }
      }

      expect(
        () =>
          new ToolRegistry({
            toolClasses: { core_tool: CoreTool },
            models: {},
            apiExtensions: { ext }
          })
      ).toThrow(/already registered by "<core>"/)
    })

    it('throws at boot when two extensions contribute the same tool name (with both keys in the error)', () => {
      const first: ApiExtension = {
        register(ctx) {
          ctx.registerTool('shared_tool', ContributedTool)
        }
      }
      const second: ApiExtension = {
        register(ctx) {
          ctx.registerTool('shared_tool', ContributedTool)
        }
      }

      expect(
        () =>
          new ToolRegistry({
            toolClasses: {},
            models: {},
            apiExtensions: { first, second }
          })
      ).toThrow(/ApiExtension "second".+already registered by "first"/)
    })
  })

  describe('ModelService mixin', () => {
    it('mixin methods are callable on the lazily constructed ModelService', async () => {
      const ext: ApiExtension = {
        register(ctx) {
          ctx.registerModelServiceMixin((service) => ({
            ping: () => `pong from ${service.apiClient.baseUrl}`
          }))
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { auth_tool: AuthTool },
        models: { book: { api: { endpoint: 'books' } } },
        createApiClient: () => noopApiClient,
        apiExtensions: { ext }
      })

      let handler: ((args: Record<string, unknown>) => Promise<ToolResult>) | undefined
      const mockServer = {
        registerTool: (name: string, _def: unknown, h: typeof handler) => {
          if (name === 'auth_tool') handler = h
        }
      } as unknown as Parameters<ToolRegistry['registerTools']>[0]

      registry.registerTools(mockServer, {
        getAccessToken: async () => 'token'
      })

      expect(handler).toBeDefined()
      const result = await handler!({})
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'pong from https://api.test'
      })
    })

    it('mixins from multiple extensions all apply', () => {
      const extA: ApiExtension = {
        register(ctx) {
          ctx.registerModelServiceMixin((_service) => ({
            methodA: () => 'a'
          }))
        }
      }
      const extB: ApiExtension = {
        register(ctx) {
          ctx.registerModelServiceMixin((_service) => ({
            methodB: () => 'b'
          }))
        }
      }

      const registry = new ToolRegistry({
        toolClasses: { auth_tool: AuthTool },
        models: { book: { api: { endpoint: 'books' } } },
        createApiClient: () => noopApiClient,
        apiExtensions: { extA, extB }
      })

      // Reach into the private internals just enough to construct a tool
      // instance and inspect its modelService.
      const tool = (
        registry as unknown as { _createInstance(c: typeof AuthTool): AuthTool }
      )._createInstance(AuthTool)
      tool.apiClient = noopApiClient
      const service = tool.modelService as unknown as {
        methodA(): string
        methodB(): string
      }
      expect(service.methodA()).toBe('a')
      expect(service.methodB()).toBe('b')
    })
  })
})
