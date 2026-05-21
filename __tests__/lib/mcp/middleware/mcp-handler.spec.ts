const { mockTransport, MockStreamableHTTPServerTransport, mockLogger } = vi.hoisted(() => {
  const transport = {
    handleRequest: vi.fn(),
    close: vi.fn(),
    sessionId: null
  }

  const MockTransportFn = vi.fn(function (config) {
    const t = { ...transport, onclose: null, _config: config }
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
    }
  }
})

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: MockStreamableHTTPServerTransport
}))

vi.mock('#src/services/logger.js', () => mockLogger)

import * as logger from '#src/services/logger.js'

import { createMcpRequestHandler } from '../../../../src/mcp/middleware/mcp-handler.js'
import { SessionManager } from '../../../../src/mcp/session-manager.js'

describe('lib/mcp/middleware/mcp-handler', () => {
  let sessionManager
  let mockMcpServer
  let createMcpServer
  let mockReq
  let mockRes

  function makeHandler(overrides = {}) {
    return createMcpRequestHandler({
      sessionManager,
      serviceName: 'test-mcp',
      isOAuthMode: true,
      staticAccessToken: null,
      createMcpServer,
      ...overrides
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    MockStreamableHTTPServerTransport.mockClear()
    mockTransport.handleRequest.mockClear()
    mockTransport.close.mockClear()

    sessionManager = new SessionManager()
    mockMcpServer = {
      connect: vi.fn(),
      close: vi.fn()
    }
    createMcpServer = vi.fn(() => mockMcpServer)

    mockReq = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      query: {},
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      socket: { setTimeout: vi.fn() },
      requestId: 'test-request-id',
      requestAccessToken: 'valid-token'
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      end: vi.fn()
    }
  })

  it('disables the socket timeout for long-lived SSE connections', async () => {
    await makeHandler()(mockReq, mockRes)
    expect(mockReq.socket.setTimeout).toHaveBeenCalledWith(0)
  })

  describe('POST - new session', () => {
    it('creates a new transport when no session id is present', async () => {
      await makeHandler()(mockReq, mockRes)
      expect(MockStreamableHTTPServerTransport).toHaveBeenCalledWith(
        expect.objectContaining({ sessionIdGenerator: expect.any(Function) })
      )
    })

    it('logs the JSON-RPC method from the request body', async () => {
      mockReq.body = { jsonrpc: '2.0', method: 'tools/call', id: 1 }
      await makeHandler()(mockReq, mockRes)
      expect(logger.info).toHaveBeenCalledWith(
        'MCP request',
        expect.objectContaining({ method: 'tools/call', sessionId: 'new' })
      )
    })

    it('hands the request off to transport.handleRequest', async () => {
      await makeHandler()(mockReq, mockRes)
      const created = MockStreamableHTTPServerTransport.mock.results[0].value
      expect(created.handleRequest).toHaveBeenCalledWith(mockReq, mockRes, mockReq.body)
    })
  })

  describe('POST - existing session', () => {
    let existing
    beforeEach(() => {
      existing = {
        transport: { handleRequest: vi.fn() },
        server: mockMcpServer,
        accessToken: 'old-token'
      }
      sessionManager.set('existing-session', existing)
      mockReq.headers['mcp-session-id'] = 'existing-session'
    })

    it('reuses the existing session and never creates a new transport', async () => {
      await makeHandler()(mockReq, mockRes)
      expect(existing.transport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes, mockReq.body)
      expect(MockStreamableHTTPServerTransport).not.toHaveBeenCalled()
    })

    it('updates the session token (and logs) on OAuth token refresh', async () => {
      mockReq.requestAccessToken = 'new-token'
      await makeHandler()(mockReq, mockRes)
      expect(sessionManager.get('existing-session').accessToken).toBe('new-token')
      expect(logger.debug).toHaveBeenCalledWith(
        'Session access token updated',
        expect.objectContaining({ sessionId: 'existing-session' })
      )
    })

    it('does not log a token update when the token is unchanged', async () => {
      existing.accessToken = 'valid-token'
      mockReq.requestAccessToken = 'valid-token'
      await makeHandler()(mockReq, mockRes)
      expect(logger.debug).not.toHaveBeenCalledWith(
        'Session access token updated',
        expect.anything()
      )
    })

    it('never updates the session token in token mode (no per-request refresh)', async () => {
      mockReq.requestAccessToken = 'something-else'
      await makeHandler({ isOAuthMode: false, staticAccessToken: 'static' })(mockReq, mockRes)
      expect(logger.debug).not.toHaveBeenCalledWith(
        'Session access token updated',
        expect.anything()
      )
    })
  })

  describe('session initialization callback', () => {
    it('stores a session entry pointing at transport + server with the request access token', async () => {
      await makeHandler()(mockReq, mockRes)
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      await transport._config.onsessioninitialized('new-session-id')

      const stored = sessionManager.get('new-session-id')
      expect(stored.transport).toBe(transport)
      expect(stored.server).toBe(mockMcpServer)
      expect(stored.accessToken).toBe('valid-token')
    })

    it('wires getAccessToken to read live from the session map in OAuth mode', async () => {
      await makeHandler()(mockReq, mockRes)
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      await transport._config.onsessioninitialized('new-session-id')

      const { getAccessToken } = createMcpServer.mock.calls[0][0]
      expect(await getAccessToken()).toBe('valid-token')

      sessionManager.get('new-session-id').accessToken = 'refreshed'
      expect(await getAccessToken()).toBe('refreshed')
    })

    it('wires getAccessToken to return the static token in token mode', async () => {
      await makeHandler({ isOAuthMode: false, staticAccessToken: 'static-api-token' })(
        mockReq,
        mockRes
      )
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      await transport._config.onsessioninitialized('new-session-id')

      const { getAccessToken } = createMcpServer.mock.calls[0][0]
      expect(await getAccessToken()).toBe('static-api-token')
    })

    it('connects the McpServer to the transport', async () => {
      await makeHandler()(mockReq, mockRes)
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      await transport._config.onsessioninitialized('new-session-id')
      expect(mockMcpServer.connect).toHaveBeenCalledWith(transport)
    })

    it('logs session creation with the originating request id', async () => {
      await makeHandler()(mockReq, mockRes)
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      await transport._config.onsessioninitialized('new-session-id')
      expect(logger.info).toHaveBeenCalledWith(
        'New MCP session created',
        expect.objectContaining({
          service: 'test-mcp',
          sessionId: 'new-session-id',
          requestId: 'test-request-id'
        })
      )
    })
  })

  describe('transport onclose', () => {
    it('removes the session from the manager and logs', async () => {
      await makeHandler()(mockReq, mockRes)
      const transport = MockStreamableHTTPServerTransport.mock.results[0].value
      transport.sessionId = 'closing-session'
      sessionManager.set('closing-session', {
        transport,
        server: mockMcpServer,
        accessToken: 'tok'
      })

      transport.onclose()

      expect(sessionManager.has('closing-session')).toBe(false)
      expect(logger.info).toHaveBeenCalledWith(
        'MCP session closed',
        expect.objectContaining({ sessionId: 'closing-session' })
      )
    })
  })

  describe('GET - SSE stream', () => {
    beforeEach(() => {
      mockReq.method = 'GET'
      mockReq.headers['mcp-session-id'] = 'existing-session'
    })

    it('returns 400 with a JSON-RPC error when the session is unknown', async () => {
      await makeHandler()(mockReq, mockRes)
      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Session not found or not initialized' },
        id: null
      })
    })

    it('delegates to transport.handleRequest for an existing session', async () => {
      const existing = {
        transport: { handleRequest: vi.fn() },
        server: mockMcpServer,
        accessToken: 'valid-token'
      }
      sessionManager.set('existing-session', existing)

      await makeHandler()(mockReq, mockRes)

      expect(existing.transport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes)
    })
  })

  describe('DELETE - terminate session', () => {
    beforeEach(() => {
      mockReq.method = 'DELETE'
      mockReq.headers['mcp-session-id'] = 'existing-session'
    })

    it('closes the transport, deletes the session, logs, and returns 200', async () => {
      const existing = {
        transport: { close: vi.fn() },
        server: mockMcpServer,
        accessToken: 'valid-token'
      }
      sessionManager.set('existing-session', existing)

      await makeHandler()(mockReq, mockRes)

      expect(existing.transport.close).toHaveBeenCalled()
      expect(sessionManager.has('existing-session')).toBe(false)
      expect(mockRes.status).toHaveBeenCalledWith(200)
      expect(mockRes.end).toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(
        'MCP session terminated',
        expect.objectContaining({ sessionId: 'existing-session' })
      )
    })

    it('returns 404 for an unknown session', async () => {
      await makeHandler()(mockReq, mockRes)
      expect(mockRes.status).toHaveBeenCalledWith(404)
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' })
    })
  })

  describe('unsupported methods', () => {
    it('returns 405 for PUT', async () => {
      mockReq.method = 'PUT'
      await makeHandler()(mockReq, mockRes)
      expect(mockRes.status).toHaveBeenCalledWith(405)
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
    })

    it('returns 405 for PATCH', async () => {
      mockReq.method = 'PATCH'
      await makeHandler()(mockReq, mockRes)
      expect(mockRes.status).toHaveBeenCalledWith(405)
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
    })
  })
})
