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
import { createOAuthRouter, sendUnauthorized } from '../../../src/mcp/middleware/oauth-router.js'
import { createRequestIdMiddleware } from '../../../src/mcp/middleware/request-id.js'
import { createRequestLoggerMiddleware } from '../../../src/mcp/middleware/request-logger.js'

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
      identityUrl: 'https://identity.example.com',
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
        pathPrefix: '/engineer-mcp',
        oauth: mockOauth,
        mcp: mockMcp
      })
      expect(s.pathPrefix).toBe('/engineer-mcp')
    })

    it('should default path prefix to empty string', () => {
      expect(server.pathPrefix).toBe('')
    })

    it('should initialize empty sessions map', () => {
      expect(server.sessions).toBeInstanceOf(Map)
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
        mcpName: 'test-mcp'
      })
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

  describe('_handleHealth', () => {
    it('should return health status', () => {
      const mockRes = { json: vi.fn() }

      server._handleHealth({}, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'ok',
        service: 'test-mcp',
        transport: 'streamable-http',
        activeSessions: 0
      })
    })

    it('should include active session count', () => {
      // Add a mock session
      server.sessions.set('session-1', { transport: {}, server: {} })
      server.sessions.set('session-2', { transport: {}, server: {} })

      const mockRes = { json: vi.fn() }

      server._handleHealth({}, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          activeSessions: 2
        })
      )
    })
  })

  describe('_handleMcp', () => {
    let mockReq
    let mockRes

    beforeEach(() => {
      mockReq = {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token'
        },
        body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        socket: { setTimeout: vi.fn() },
        requestId: 'test-request-id'
      }

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        end: vi.fn()
      }

      mockOauth.introspectToken.mockResolvedValue({ active: true })
    })

    describe('authentication', () => {
      it('should disable socket timeout', async () => {
        await server._handleMcp(mockReq, mockRes)

        expect(mockReq.socket.setTimeout).toHaveBeenCalledWith(0)
      })

      it('should return 401 when no Bearer token', async () => {
        mockExtractBearerToken.mockReturnValueOnce(null)

        await server._handleMcp(mockReq, mockRes)

        expect(sendUnauthorized).toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(
          'No Bearer token in request',
          expect.objectContaining({ service: 'test-mcp' })
        )
      })

      it('should return 401 when token introspection fails', async () => {
        mockOauth.introspectToken.mockResolvedValue({ active: false })

        await server._handleMcp(mockReq, mockRes)

        expect(sendUnauthorized).toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(
          'Token introspection failed - token inactive',
          expect.objectContaining({ service: 'test-mcp' })
        )
      })
    })

    describe('POST - new session', () => {
      it('should create new transport when no session exists', async () => {
        await server._handleMcp(mockReq, mockRes)

        expect(MockStreamableHTTPServerTransport).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionIdGenerator: expect.any(Function)
          })
        )
      })

      it('should log MCP method from request body', async () => {
        mockReq.body = { jsonrpc: '2.0', method: 'tools/call', id: 1 }

        await server._handleMcp(mockReq, mockRes)

        expect(logger.info).toHaveBeenCalledWith(
          'MCP request',
          expect.objectContaining({
            method: 'tools/call',
            sessionId: 'new'
          })
        )
      })

      it('should call transport.handleRequest', async () => {
        const transport = MockStreamableHTTPServerTransport.mock.results[0]?.value
        if (transport) {
          await server._handleMcp(mockReq, mockRes)
          // Transport is created during _handleMcp, so we need to get the latest
        }

        await server._handleMcp(mockReq, mockRes)

        const createdTransport = MockStreamableHTTPServerTransport.mock.results[0].value
        expect(createdTransport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes, mockReq.body)
      })
    })

    describe('POST - existing session', () => {
      beforeEach(() => {
        const mockSession = {
          transport: { handleRequest: vi.fn() },
          server: mockMcpServer,
          accessToken: 'old-token'
        }
        server.sessions.set('existing-session', mockSession)
        mockReq.headers['mcp-session-id'] = 'existing-session'
      })

      it('should reuse existing session', async () => {
        await server._handleMcp(mockReq, mockRes)

        const session = server.sessions.get('existing-session')
        expect(session.transport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes, mockReq.body)
        expect(MockStreamableHTTPServerTransport).not.toHaveBeenCalled()
      })

      it('should update access token when changed', async () => {
        mockReq.headers.authorization = 'Bearer new-token'
        mockExtractBearerToken.mockReturnValueOnce('new-token')

        await server._handleMcp(mockReq, mockRes)

        const session = server.sessions.get('existing-session')
        expect(session.accessToken).toBe('new-token')
        expect(logger.debug).toHaveBeenCalledWith(
          'Session access token updated',
          expect.objectContaining({ sessionId: 'existing-session' })
        )
      })

      it('should not update token when unchanged', async () => {
        const session = server.sessions.get('existing-session')
        session.accessToken = 'valid-token'
        mockExtractBearerToken.mockReturnValueOnce('valid-token')

        await server._handleMcp(mockReq, mockRes)

        expect(logger.debug).not.toHaveBeenCalledWith(
          'Session access token updated',
          expect.anything()
        )
      })
    })

    describe('GET - SSE stream', () => {
      beforeEach(() => {
        mockReq.method = 'GET'
        mockReq.headers['mcp-session-id'] = 'existing-session'
      })

      it('should return 400 when session not found', async () => {
        await server._handleMcp(mockReq, mockRes)

        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.json).toHaveBeenCalledWith({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Session not found or not initialized' },
          id: null
        })
      })

      it('should call transport.handleRequest for existing session', async () => {
        const mockSession = {
          transport: { handleRequest: vi.fn() },
          server: mockMcpServer,
          accessToken: 'valid-token'
        }
        server.sessions.set('existing-session', mockSession)

        await server._handleMcp(mockReq, mockRes)

        expect(mockSession.transport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes)
      })
    })

    describe('DELETE - terminate session', () => {
      beforeEach(() => {
        mockReq.method = 'DELETE'
        mockReq.headers['mcp-session-id'] = 'existing-session'
      })

      it('should terminate and delete session', async () => {
        const mockSession = {
          transport: { close: vi.fn() },
          server: mockMcpServer,
          accessToken: 'valid-token'
        }
        server.sessions.set('existing-session', mockSession)

        await server._handleMcp(mockReq, mockRes)

        expect(mockSession.transport.close).toHaveBeenCalled()
        expect(server.sessions.has('existing-session')).toBe(false)
        expect(mockRes.status).toHaveBeenCalledWith(200)
        expect(mockRes.end).toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(
          'MCP session terminated',
          expect.objectContaining({ sessionId: 'existing-session' })
        )
      })

      it('should return 404 for non-existent session', async () => {
        await server._handleMcp(mockReq, mockRes)

        expect(mockRes.status).toHaveBeenCalledWith(404)
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' })
      })
    })

    describe('unsupported methods', () => {
      it('should return 405 for PUT', async () => {
        mockReq.method = 'PUT'

        await server._handleMcp(mockReq, mockRes)

        expect(mockRes.status).toHaveBeenCalledWith(405)
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
      })

      it('should return 405 for PATCH', async () => {
        mockReq.method = 'PATCH'

        await server._handleMcp(mockReq, mockRes)

        expect(mockRes.status).toHaveBeenCalledWith(405)
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
      })
    })
  })

  describe('token mode - _handleMcp', () => {
    let tokenServer
    let mockReq
    let mockRes

    beforeEach(() => {
      tokenServer = new HttpServer({
        port: 3000,
        accessToken: 'static-api-token',
        mcp: mockMcp
      })

      mockReq = {
        method: 'POST',
        headers: {},
        body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        socket: { setTimeout: vi.fn() },
        requestId: 'test-request-id'
      }

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        end: vi.fn()
      }
    })

    it('should accept requests without Bearer token', async () => {
      await tokenServer._handleMcp(mockReq, mockRes)

      // Should create transport (not return 401)
      expect(mockSendUnauthorized).not.toHaveBeenCalled()
      expect(MockStreamableHTTPServerTransport).toHaveBeenCalled()
    })

    it('should create session with static getAccessToken', async () => {
      await tokenServer._handleMcp(mockReq, mockRes)

      const transport = MockStreamableHTTPServerTransport.mock.results[0].value

      // Simulate session initialization
      await transport._config.onsessioninitialized('token-session-id')

      // Verify createServer was called with getAccessToken
      const { getAccessToken } = mockMcp.createServer.mock.calls[0][0]
      const token = await getAccessToken()
      expect(token).toBe('static-api-token')
    })

    it('should not update session token on existing sessions', async () => {
      const mockSession = {
        transport: { handleRequest: vi.fn() },
        server: mockMcpServer,
        accessToken: 'static-api-token'
      }
      tokenServer.sessions.set('existing-session', mockSession)
      mockReq.headers['mcp-session-id'] = 'existing-session'

      await tokenServer._handleMcp(mockReq, mockRes)

      // Should not log token update
      expect(logger.debug).not.toHaveBeenCalledWith(
        'Session access token updated',
        expect.anything()
      )
    })
  })

  describe('session initialization', () => {
    let mockReq
    let mockRes

    beforeEach(() => {
      mockReq = {
        method: 'POST',
        headers: { authorization: 'Bearer valid-token' },
        body: { jsonrpc: '2.0', method: 'initialize', id: 1 },
        socket: { setTimeout: vi.fn() },
        requestId: 'test-request-id'
      }

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        end: vi.fn()
      }

      mockOauth.introspectToken.mockResolvedValue({ active: true })
      mockExtractBearerToken.mockReturnValue('valid-token')
    })

    it('should create session with correct structure on onsessioninitialized', async () => {
      await server._handleMcp(mockReq, mockRes)

      // Get the transport config from the mock
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      const config = transport._config

      // Simulate session initialization
      await config.onsessioninitialized('new-session-id')

      // Verify session was created
      expect(server.sessions.has('new-session-id')).toBe(true)
      const session = server.sessions.get('new-session-id')
      expect(session.transport).toBe(transport)
      expect(session.server).toBe(mockMcpServer)
      expect(session.accessToken).toBe('valid-token')
    })

    it('should create MCP server with getAccessToken that reads from session', async () => {
      await server._handleMcp(mockReq, mockRes)

      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      const config = transport._config

      // Simulate session initialization
      await config.onsessioninitialized('new-session-id')

      // Verify createServer was called with getAccessToken
      expect(mockMcp.createServer).toHaveBeenCalledWith({
        sessionId: 'new-session-id',
        getAccessToken: expect.any(Function)
      })

      // Get the getAccessToken function and verify it reads from session
      const { getAccessToken } = mockMcp.createServer.mock.calls[0][0]

      // Token should be readable
      const token = await getAccessToken()
      expect(token).toBe('valid-token')

      // Update the session token and verify getAccessToken returns the new value
      server.sessions.get('new-session-id').accessToken = 'refreshed-token'
      const newToken = await getAccessToken()
      expect(newToken).toBe('refreshed-token')
    })

    it('should connect MCP server to transport', async () => {
      await server._handleMcp(mockReq, mockRes)

      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      const config = transport._config

      await config.onsessioninitialized('new-session-id')

      expect(mockMcpServer.connect).toHaveBeenCalledWith(transport)
    })

    it('should log session creation', async () => {
      await server._handleMcp(mockReq, mockRes)

      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      const config = transport._config

      await config.onsessioninitialized('new-session-id')

      expect(logger.info).toHaveBeenCalledWith(
        'New MCP session created',
        expect.objectContaining({
          service: 'test-mcp',
          sessionId: 'new-session-id'
        })
      )
    })
  })

  describe('transport onclose handler', () => {
    let mockReq
    let mockRes

    beforeEach(() => {
      mockReq = {
        method: 'POST',
        headers: { authorization: 'Bearer valid-token' },
        body: {},
        socket: { setTimeout: vi.fn() },
        requestId: 'test-request-id'
      }

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }

      mockOauth.introspectToken.mockResolvedValue({ active: true })
      mockExtractBearerToken.mockReturnValue('valid-token')
    })

    it('should delete session on transport close', async () => {
      await server._handleMcp(mockReq, mockRes)

      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      transport.sessionId = 'closing-session-id'

      // Add session first
      server.sessions.set('closing-session-id', {
        transport,
        server: mockMcpServer,
        accessToken: 'token'
      })

      // Trigger onclose
      transport.onclose()

      expect(server.sessions.has('closing-session-id')).toBe(false)
      expect(logger.info).toHaveBeenCalledWith(
        'MCP session closed',
        expect.objectContaining({ sessionId: 'closing-session-id' })
      )
    })
  })

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
    it('should start HTTP server on configured port', () => {
      // Mock listen to not actually start server
      const mockListen = vi.fn((port, callback) => {
        callback()
        return { close: vi.fn() }
      })
      server.app.listen = mockListen

      server.start()

      expect(mockListen).toHaveBeenCalledWith(3000, expect.any(Function))
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
