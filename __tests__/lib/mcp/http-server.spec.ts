// Define mocks using vi.hoisted()
const {
  mockTransport,
  MockStreamableHTTPServerTransport,
  mockLogger,
  mockRequestIdMiddleware,
  mockRequestLoggerMiddleware,
  mockOAuthRouter,
  mockExtractBearerToken,
  mockSendUnauthorized
} = vi.hoisted(() => {
  const transport = {
    handleRequest: vi.fn(),
    close: vi.fn(),
    sessionId: null
  }

  // Use a function expression (not arrow) so it can be used as a constructor
  const MockTransportFn = vi.fn(function (config) {
    const t = { ...transport, onclose: null }
    // Store config for later use in tests
    t._config = config
    return t
  })

  return {
    mockTransport: transport,
    MockStreamableHTTPServerTransport: MockTransportFn,
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    mockRequestIdMiddleware: vi.fn(() => (req, res, next) => {
      req.requestId = 'test-request-id'
      next()
    }),
    mockRequestLoggerMiddleware: vi.fn(() => (req, res, next) => next()),
    mockOAuthRouter: vi.fn(),
    mockExtractBearerToken: vi.fn((req) => req.headers?.authorization?.slice(7) || null),
    mockSendUnauthorized: vi.fn((req, res) => {
      res.status(401).json({ error: 'unauthorized' })
    })
  }
})

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: MockStreamableHTTPServerTransport
}))

vi.mock('#src/services/logger.js', () => mockLogger)

vi.mock('../../../src/mcp/middleware/request-id.js', () => ({
  createRequestIdMiddleware: mockRequestIdMiddleware
}))

vi.mock('../../../src/mcp/middleware/request-logger.js', () => ({
  createRequestLoggerMiddleware: mockRequestLoggerMiddleware
}))

vi.mock('../../../src/mcp/middleware/oauth-router.js', () => ({
  createOAuthRouter: vi.fn(() => mockOAuthRouter),
  extractBearerToken: mockExtractBearerToken,
  sendUnauthorized: mockSendUnauthorized
}))

import * as logger from '#src/services/logger.js'

import { HttpServer } from '../../../src/mcp/http-server.js'
import { createOAuthRouter } from '../../../src/mcp/middleware/oauth-router.js'
import { createRequestIdMiddleware } from '../../../src/mcp/middleware/request-id.js'
import { createRequestLoggerMiddleware } from '../../../src/mcp/middleware/request-logger.js'
import { SessionManager } from '../../../src/mcp/session-manager.js'

describe('lib/mcp/http-server', () => {
  let server
  let mockOauth
  let mockMcp
  let mockMcpServer

  beforeEach(() => {
    vi.clearAllMocks()
    MockStreamableHTTPServerTransport.mockClear()
    mockTransport.handleRequest.mockClear()
    mockTransport.close.mockClear()

    mockMcpServer = {
      connect: vi.fn(),
      close: vi.fn()
    }

    mockOauth = {
      authServerUrl: 'https://identity.example.com',
      introspectToken: vi.fn()
    }

    mockMcp = {
      name: 'test-mcp',
      createServer: vi.fn(() => mockMcpServer)
    }

    server = new HttpServer({
      port: 3000,
      oauth: mockOauth,
      mcp: mockMcp
    })
  })

  afterEach(() => {
    // Clean up any listeners
    if (server.httpServer) {
      server.httpServer.close()
    }
  })

  describe('constructor', () => {
    it('should set default baseUrl from port', () => {
      expect(server.baseUrl).toBe('http://localhost:3000')
    })

    it('should use provided baseUrl', () => {
      const s = new HttpServer({
        port: 3000,
        baseUrl: 'https://mcp.example.com',
        oauth: mockOauth,
        mcp: mockMcp
      })
      expect(s.baseUrl).toBe('https://mcp.example.com')
    })

    it('should set path prefix', () => {
      const s = new HttpServer({
        port: 3000,
        pathPrefix: '/my-mcp-server',
        oauth: mockOauth,
        mcp: mockMcp
      })
      expect(s.pathPrefix).toBe('/my-mcp-server')
    })

    it('should default path prefix to empty string', () => {
      expect(server.pathPrefix).toBe('')
    })

    it('should initialize empty sessions map', () => {
      expect(server.sessions).toBeInstanceOf(SessionManager)
      expect(server.sessions.size).toBe(0)
    })

    it('should setup middleware', () => {
      expect(createRequestIdMiddleware).toHaveBeenCalled()
      expect(createRequestLoggerMiddleware).toHaveBeenCalled()
    })

    it('should register OAuth router', () => {
      expect(createOAuthRouter).toHaveBeenCalledWith({
        oauth: mockOauth,
        baseUrl: 'http://localhost:3000',
        mcpName: 'test-mcp',
        serveProtectedResourceMetadata: true
      })
    })

    // RFC 9728 §3.1: .well-known URIs are origin-scoped. When mounted under a
    // sub-path, the upstream reverse proxy owns the PRM endpoints — instruct
    // the OAuth router to skip registration so we don't leave dead endpoints
    // at the wrong location inside the prefix.
    it('should disable PRM endpoints when pathPrefix is set', () => {
      createOAuthRouter.mockClear()
      new HttpServer({
        port: 3000,
        baseUrl: 'https://example.com/my-mcp-server',
        pathPrefix: '/my-mcp-server',
        oauth: mockOauth,
        mcp: mockMcp
      })
      expect(createOAuthRouter).toHaveBeenCalledWith(
        expect.objectContaining({ serveProtectedResourceMetadata: false })
      )
    })

    it('should enable PRM endpoints by default (no pathPrefix)', () => {
      createOAuthRouter.mockClear()
      new HttpServer({
        port: 3000,
        baseUrl: 'https://mcp.example.com',
        oauth: mockOauth,
        mcp: mockMcp
      })
      expect(createOAuthRouter).toHaveBeenCalledWith(
        expect.objectContaining({ serveProtectedResourceMetadata: true })
      )
    })

    it('should throw when neither oauth nor accessToken provided', () => {
      expect(() => new HttpServer({ port: 3000, mcp: mockMcp })).toThrow(
        'HttpServer requires either oauth (OAuth mode) or accessToken (token mode)'
      )
    })

    it('should throw when both oauth and accessToken provided', () => {
      expect(
        () => new HttpServer({ port: 3000, oauth: mockOauth, accessToken: 'token', mcp: mockMcp })
      ).toThrow('HttpServer cannot use both oauth and accessToken — choose one mode')
    })

    it('should accept accessToken in token mode', () => {
      const s = new HttpServer({ port: 3000, accessToken: 'my-token', mcp: mockMcp })
      expect(s.accessToken).toBe('my-token')
      expect(s.oauth).toBeNull()
    })

    it('should not register OAuth router in token mode', () => {
      const callsBefore = createOAuthRouter.mock.calls.length
      new HttpServer({ port: 3000, accessToken: 'my-token', mcp: mockMcp })
      expect(createOAuthRouter.mock.calls.length).toBe(callsBefore)
    })
  })

  // _handleHealth + _handleCacheStats moved to __tests__/lib/mcp/middleware/status-router.spec.ts
  // _handleMcp logic moved to __tests__/lib/mcp/middleware/mcp-handler.spec.ts
  // Auth logic moved to __tests__/lib/mcp/middleware/mcp-auth.spec.ts

  describe('_handleLegacySse', () => {
    it('should return 410 Gone with deprecation message', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }

      server._handleLegacySse({}, mockRes)

      expect(mockRes.status).toHaveBeenCalledWith(410)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'SSE transport deprecated',
        message: 'Please use Streamable HTTP transport at /mcp endpoint',
        spec: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports'
      })
    })
  })

  describe('start', () => {
    it('should start HTTP server on configured port', async () => {
      const { EventEmitter } = await import('node:events')
      const fakeServer = new EventEmitter() as EventEmitter & { close: () => void }
      fakeServer.close = vi.fn()

      // start() subscribes to 'listening' / 'error' on the returned server
      // rather than passing a callback to listen().
      const mockListen = vi.fn(() => fakeServer)
      server.app.listen = mockListen as unknown as typeof server.app.listen

      server.start()
      fakeServer.emit('listening')

      expect(mockListen).toHaveBeenCalledWith(3000)
      expect(logger.info).toHaveBeenCalledWith(
        'test-mcp (Streamable HTTP, oauth) started',
        expect.objectContaining({
          port: 3000,
          authMode: 'oauth',
          mcpEndpoint: 'http://localhost:3000/mcp',
          healthEndpoint: 'http://localhost:3000/health'
        })
      )
    })

    it('should log ERROR and exit when listen fails (EADDRINUSE)', async () => {
      const { EventEmitter } = await import('node:events')
      const fakeServer = new EventEmitter() as EventEmitter & { close: () => void }
      fakeServer.close = vi.fn()

      // Return the emitter without invoking the success callback — simulates
      // bind starting, then failing asynchronously.
      server.app.listen = vi.fn(() => fakeServer) as unknown as typeof server.app.listen

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)

      server.start()

      const err = Object.assign(new Error('listen EADDRINUSE: address already in use :::3000'), {
        code: 'EADDRINUSE',
        syscall: 'listen'
      })
      fakeServer.emit('error', err)

      // Let the async handler flush its microtasks.
      await new Promise((r) => setImmediate(r))

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('HTTP server failed to bind on port 3000'),
        expect.objectContaining({
          code: 'EADDRINUSE',
          port: 3000,
          syscall: 'listen'
        })
      )
      expect(exitSpy).toHaveBeenCalledWith(1)

      exitSpy.mockRestore()
    })
  })

  describe('_shutdown', () => {
    it('should close all MCP sessions', async () => {
      const mockSession1 = { server: { close: vi.fn() }, transport: {} }
      const mockSession2 = { server: { close: vi.fn() }, transport: {} }

      server.sessions.set('session-1', mockSession1)
      server.sessions.set('session-2', mockSession2)

      // Mock httpServer
      server.httpServer = { close: vi.fn() }

      // Mock process.exit to prevent actual exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {})

      await server._shutdown()

      expect(mockSession1.server.close).toHaveBeenCalled()
      expect(mockSession2.server.close).toHaveBeenCalled()
      expect(server.httpServer.close).toHaveBeenCalled()
      expect(mockExit).toHaveBeenCalledWith(0)

      mockExit.mockRestore()
    })

    it('should handle errors during session close', async () => {
      const mockSession = {
        server: {
          close: vi.fn().mockRejectedValue(new Error('Close failed'))
        },
        transport: {}
      }

      server.sessions.set('failing-session', mockSession)
      server.httpServer = { close: vi.fn() }

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {})

      await server._shutdown()

      expect(logger.error).toHaveBeenCalledWith(
        'Error closing session',
        expect.objectContaining({
          sessionId: 'failing-session',
          error: 'Close failed'
        })
      )

      mockExit.mockRestore()
    })
  })
})
