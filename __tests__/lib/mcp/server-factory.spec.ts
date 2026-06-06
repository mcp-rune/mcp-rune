// Define mocks using vi.hoisted()
const { mockUnderlyingServer, MockMcpServer, mockSchemas, mockErrorTracking, mockTracing } =
  vi.hoisted(() => {
    const underlyingServer = {
      setRequestHandler: vi.fn(),
      registerCapabilities: vi.fn(),
      oninitialized: undefined as (() => void) | undefined,
      getClientVersion: vi.fn(),
      getClientCapabilities: vi.fn()
    }
    const MockMcpServerFn = vi.fn(function () {
      this.server = underlyingServer
      this.registerTool = vi.fn()
    })
    return {
      mockUnderlyingServer: underlyingServer,
      MockMcpServer: MockMcpServerFn,
      mockSchemas: {
        CompleteRequestSchema: Symbol('CompleteRequestSchema'),
        ListPromptsRequestSchema: Symbol('ListPromptsRequestSchema'),
        GetPromptRequestSchema: Symbol('GetPromptRequestSchema')
      },
      mockErrorTracking: {
        setMcpClientContext: vi.fn()
      },
      mockTracing: {
        setSessionContext: vi.fn()
      }
    }
  })

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: MockMcpServer
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => mockSchemas)

// Mock logger
vi.mock('#src/runtime/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Mock error tracking and tracing
vi.mock('#src/runtime/error-tracking.js', () => mockErrorTracking)
vi.mock('#src/runtime/tracing.js', () => mockTracing)

// Mock form handlers
vi.mock('#src/mcp/forms/form-handlers.js', () => ({
  registerFormHandlers: vi.fn(),
  addFormCapabilityMeta: vi.fn((prompts) => prompts)
}))

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CompleteRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { createServer } from '../../../src/mcp/server-factory.js'
import * as logger from '../../../src/runtime/logger.js'

describe('lib/mcp/server-factory', () => {
  let mockToolRegistry
  let mockPromptRegistry
  let mockGetAccessToken

  beforeEach(() => {
    vi.clearAllMocks()
    mockUnderlyingServer.oninitialized = undefined

    mockToolRegistry = {
      registerTools: vi.fn(),
      serverContext: {}
    }

    mockPromptRegistry = {
      getDefinitions: vi.fn(() => [
        { name: 'create_study_session', description: 'Create session' }
      ]),
      getPrompt: vi.fn(() => ({
        description: 'Test prompt',
        messages: [{ role: 'user', content: { type: 'text', text: 'Test' } }]
      })),
      getPromptClass: vi.fn(() => null)
    }

    mockGetAccessToken = vi.fn(async () => 'test-token')
  })

  describe('createServer', () => {
    it('should create McpServer with correct name and version', () => {
      createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'test-session-1',
        transport: 'stdio',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      expect(McpServer).toHaveBeenCalledWith({ name: 'test-server', version: '1.0.0' })
    })

    it('should call toolRegistry.registerTools with mcpServer', () => {
      createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'test-session-1',
        transport: 'stdio',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      expect(mockToolRegistry.registerTools).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          getAccessToken: mockGetAccessToken
        })
      )
    })

    it('should return the McpServer instance', () => {
      const result = createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'test-session-1',
        transport: 'stdio',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      expect(result).toBeDefined()
      expect(result.registerTool).toBeDefined()
    })

    it('should call appRegistry.registerTools and registerResources when provided', () => {
      const mockAppRegistry = {
        registerTools: vi.fn(),
        registerResources: vi.fn(),
        getToolNames: vi.fn(() => ['find_model_app'])
      }

      createServer({
        name: 'test-server',
        version: '1.0.0',
        toolRegistry: mockToolRegistry,
        appRegistry: mockAppRegistry,
        getAccessToken: mockGetAccessToken
      })

      expect(mockAppRegistry.registerTools).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ getAccessToken: mockGetAccessToken })
      )
      expect(mockAppRegistry.registerResources).toHaveBeenCalledWith(expect.any(Object))
    })
  })

  describe('CompleteRequestSchema handler', () => {
    function getCompletionHandler() {
      return mockUnderlyingServer.setRequestHandler.mock.calls.find(
        (call) => call[0] === CompleteRequestSchema
      )[1]
    }

    function createServerWithPrompts(promptRegistryOverrides = {}) {
      const registry = { ...mockPromptRegistry, ...promptRegistryOverrides }
      createServer({
        name: 'test-server',
        version: '1.0.0',
        toolRegistry: mockToolRegistry,
        promptRegistry: registry,
        getAccessToken: mockGetAccessToken
      })
      return getCompletionHandler()
    }

    it('should return empty values for non-prompt ref types', async () => {
      const handler = createServerWithPrompts()

      const result = await handler({
        params: {
          ref: { type: 'ref/resource', name: 'some_resource' },
          argument: { name: 'field', value: '' }
        }
      })

      expect(result.completion.values).toEqual([])
      expect(result.completion.hasMore).toBe(false)
    })

    it('should return empty values when no model extracted from prompt name', async () => {
      const handler = createServerWithPrompts()

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: null },
          argument: { name: 'field', value: '' }
        }
      })

      expect(result.completion.values).toEqual([])
      expect(result.completion.hasMore).toBe(false)
    })

    it('should return empty values when prompt class not found', async () => {
      const handler = createServerWithPrompts({
        getPromptClass: vi.fn(() => null)
      })

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_study_session' },
          argument: { name: 'status', value: '' }
        }
      })

      expect(result.completion.values).toEqual([])
      expect(result.completion.hasMore).toBe(false)
    })

    it('should return empty values when field has no completion enabled', async () => {
      const mockPromptClass = {
        fieldDefinitions: {
          title: {
            type: 'string',
            description: 'Title'
          }
        }
      }

      const handler = createServerWithPrompts({
        getPromptClass: vi.fn(() => mockPromptClass)
      })

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_book' },
          argument: { name: 'title', value: '' }
        }
      })

      expect(result.completion.values).toEqual([])
      expect(result.completion.hasMore).toBe(false)
    })

    it('should return filtered enum values when field has completion and enumValues', async () => {
      const mockPromptClass = {
        fieldDefinitions: {
          status: {
            type: 'enum',
            description: 'Current status',
            completion: { enabled: true },
            enumValues: ['active', 'inactive', 'archived']
          }
        }
      }

      const handler = createServerWithPrompts({
        getPromptClass: vi.fn(() => mockPromptClass)
      })

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_book' },
          argument: { name: 'status', value: '' }
        }
      })

      expect(result.completion.values).toEqual(['active', 'inactive', 'archived'])
      expect(result.completion.total).toBe(3)
      expect(result.completion.hasMore).toBe(false)
    })

    it('should filter enum values by query', async () => {
      const mockPromptClass = {
        fieldDefinitions: {
          status: {
            type: 'enum',
            description: 'Current status',
            completion: { enabled: true },
            enumValues: ['active', 'inactive', 'archived']
          }
        }
      }

      const handler = createServerWithPrompts({
        getPromptClass: vi.fn(() => mockPromptClass)
      })

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_book' },
          argument: { name: 'status', value: 'act' }
        }
      })

      expect(result.completion.values).toEqual(['active', 'inactive'])
    })

    it('should filter enum values case-insensitively', async () => {
      const mockPromptClass = {
        fieldDefinitions: {
          status: {
            type: 'enum',
            description: 'Current status',
            completion: { enabled: true },
            enumValues: ['Active', 'Inactive', 'Archived']
          }
        }
      }

      const handler = createServerWithPrompts({
        getPromptClass: vi.fn(() => mockPromptClass)
      })

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_book' },
          argument: { name: 'status', value: 'ACT' }
        }
      })

      expect(result.completion.values).toEqual(['Active', 'Inactive'])
    })

    it('should return empty values for non-enum fields with completion enabled', async () => {
      const mockPromptClass = {
        fieldDefinitions: {
          title: {
            type: 'string',
            description: 'Title',
            completion: { enabled: true }
          }
        }
      }

      const handler = createServerWithPrompts({
        getPromptClass: vi.fn(() => mockPromptClass)
      })

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_book' },
          argument: { name: 'title', value: 'test' }
        }
      })

      expect(result.completion.values).toEqual([])
      expect(result.completion.hasMore).toBe(false)
    })
  })

  describe('oninitialized hook', () => {
    it('should set oninitialized callback on the underlying server', () => {
      createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'test-session-1',
        transport: 'stdio',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      expect(mockUnderlyingServer.oninitialized).toBeTypeOf('function')
    })

    it('should log client info and enrich context when client connects', () => {
      mockUnderlyingServer.getClientVersion.mockReturnValue({
        name: 'claude-code',
        version: '1.2.3'
      })
      mockUnderlyingServer.getClientCapabilities.mockReturnValue({
        sampling: {},
        roots: { listChanged: true }
      })

      createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'session-abc',
        transport: 'stdio',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      // Trigger the oninitialized hook
      mockUnderlyingServer.oninitialized!()

      expect(logger.info).toHaveBeenCalledWith(
        'Client connected',
        expect.objectContaining({
          service: 'test-server',
          sessionId: 'session-abc',
          clientName: 'claude-code',
          clientVersion: '1.2.3',
          transport: 'stdio',
          capabilities: {
            sampling: true,
            roots: true,
            rootsListChanged: true,
            experimental: []
          }
        })
      )

      expect(mockErrorTracking.setMcpClientContext).toHaveBeenCalledWith({
        name: 'claude-code',
        version: '1.2.3',
        transport: 'stdio'
      })

      expect(mockTracing.setSessionContext).toHaveBeenCalledWith({
        sessionId: 'session-abc',
        metadata: {
          transport: 'stdio',
          clientName: 'claude-code',
          clientVersion: '1.2.3'
        }
      })
    })

    it('should default to unknown when client version is not available', () => {
      mockUnderlyingServer.getClientVersion.mockReturnValue(undefined)
      mockUnderlyingServer.getClientCapabilities.mockReturnValue(undefined)

      createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'session-xyz',
        transport: 'streamable-http',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      mockUnderlyingServer.oninitialized!()

      expect(logger.info).toHaveBeenCalledWith(
        'Client connected',
        expect.objectContaining({
          clientName: 'unknown',
          clientVersion: 'unknown',
          transport: 'streamable-http',
          capabilities: {
            sampling: false,
            roots: false,
            rootsListChanged: false,
            experimental: []
          }
        })
      )

      expect(mockErrorTracking.setMcpClientContext).toHaveBeenCalledWith({
        name: 'unknown',
        version: 'unknown',
        transport: 'streamable-http'
      })
    })

    it('should include experimental capability keys', () => {
      mockUnderlyingServer.getClientVersion.mockReturnValue({
        name: 'opencode',
        version: '0.5.0'
      })
      mockUnderlyingServer.getClientCapabilities.mockReturnValue({
        experimental: { tasks: {}, streaming: {} }
      })

      createServer({
        name: 'test-server',
        version: '1.0.0',
        sessionId: 'session-exp',
        transport: 'stdio',
        toolRegistry: mockToolRegistry,
        getAccessToken: mockGetAccessToken
      })

      mockUnderlyingServer.oninitialized!()

      expect(logger.info).toHaveBeenCalledWith(
        'Client connected',
        expect.objectContaining({
          capabilities: expect.objectContaining({
            experimental: ['tasks', 'streaming']
          })
        })
      )
    })
  })

  describe('completion handler prompt lookup', () => {
    function createHandlerWithPromptCheck() {
      const getPromptClass = vi.fn(() => null)

      createServer({
        name: 'test-server',
        version: '1.0.0',
        toolRegistry: mockToolRegistry,
        promptRegistry: { ...mockPromptRegistry, getPromptClass },
        getAccessToken: mockGetAccessToken
      })

      const handler = mockUnderlyingServer.setRequestHandler.mock.calls.find(
        (call) => call[0] === CompleteRequestSchema
      )[1]

      return { handler, getPromptClass }
    }

    it('should look up prompt class by prompt name', async () => {
      const { handler, getPromptClass } = createHandlerWithPromptCheck()

      await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'create_book' },
          argument: { name: 'status', value: '' }
        }
      })

      expect(getPromptClass).toHaveBeenCalledWith('create_book')
    })

    it('should return empty values for unknown prompt', async () => {
      const { handler, getPromptClass } = createHandlerWithPromptCheck()

      const result = await handler({
        params: {
          ref: { type: 'ref/prompt', name: 'nonexistent' },
          argument: { name: 'status', value: '' }
        }
      })

      expect(getPromptClass).toHaveBeenCalledWith('nonexistent')
      expect(result.completion.values).toEqual([])
    })
  })
})
