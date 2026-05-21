const { mockLogger, mockExtractBearerToken, mockSendUnauthorized } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  mockExtractBearerToken: vi.fn(),
  mockSendUnauthorized: vi.fn((_req, res) => {
    res.status(401).json({ error: 'unauthorized' })
  })
}))

vi.mock('#src/services/logger.js', () => mockLogger)

vi.mock('../../../../src/mcp/middleware/oauth-router.js', () => ({
  extractBearerToken: mockExtractBearerToken,
  sendUnauthorized: mockSendUnauthorized
}))

import * as logger from '#src/services/logger.js'

import { createMcpAuthMiddleware } from '../../../../src/mcp/middleware/mcp-auth.js'

describe('lib/mcp/middleware/mcp-auth', () => {
  let mockReq
  let mockRes
  let mockNext

  beforeEach(() => {
    vi.clearAllMocks()
    mockReq = {
      method: 'POST',
      headers: {},
      query: {},
      requestId: 'rid'
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }
    mockNext = vi.fn()
  })

  describe('access_token query parameter (OAuth 2.1 §5.1.2)', () => {
    it('rejects with 400 when access_token is in the query string', async () => {
      const middleware = createMcpAuthMiddleware({
        oauth: { introspectToken: vi.fn() },
        accessToken: null,
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })
      mockReq.query = { access_token: 'leaked' }

      await middleware(mockReq, mockRes, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description:
          'Bearer tokens in URI query parameters are not allowed (OAuth 2.1 §5.1.2)'
      })
      expect(mockNext).not.toHaveBeenCalled()
    })

    it('rejects even when a valid Authorization header is also present', async () => {
      const introspect = vi.fn().mockResolvedValue({ active: true })
      const middleware = createMcpAuthMiddleware({
        oauth: { introspectToken: introspect },
        accessToken: null,
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })
      mockReq.query = { access_token: 'leaked' }
      mockReq.headers.authorization = 'Bearer good'
      mockExtractBearerToken.mockReturnValue('good')

      await middleware(mockReq, mockRes, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(introspect).not.toHaveBeenCalled()
    })

    it('rejects in token mode as well', async () => {
      const middleware = createMcpAuthMiddleware({
        oauth: null,
        accessToken: 'static',
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })
      mockReq.query = { access_token: 'leaked' }

      await middleware(mockReq, mockRes, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockNext).not.toHaveBeenCalled()
    })
  })

  describe('OAuth mode', () => {
    it('returns 401 via sendUnauthorized when no Bearer token', async () => {
      const middleware = createMcpAuthMiddleware({
        oauth: { introspectToken: vi.fn() },
        accessToken: null,
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })
      mockExtractBearerToken.mockReturnValue(null)

      await middleware(mockReq, mockRes, mockNext)

      expect(mockSendUnauthorized).toHaveBeenCalledWith(mockReq, mockRes, 'https://example.com')
      expect(logger.info).toHaveBeenCalledWith(
        'No Bearer token in request',
        expect.objectContaining({ service: 'svc', requestId: 'rid' })
      )
      expect(mockNext).not.toHaveBeenCalled()
    })

    it('returns 401 via sendUnauthorized when introspection reports inactive', async () => {
      const introspect = vi.fn().mockResolvedValue({ active: false })
      const middleware = createMcpAuthMiddleware({
        oauth: { introspectToken: introspect },
        accessToken: null,
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })
      mockExtractBearerToken.mockReturnValue('bad-token')

      await middleware(mockReq, mockRes, mockNext)

      expect(introspect).toHaveBeenCalledWith('bad-token')
      expect(mockSendUnauthorized).toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(
        'Token introspection failed - token inactive',
        expect.objectContaining({ service: 'svc' })
      )
      expect(mockNext).not.toHaveBeenCalled()
    })

    it('attaches the bearer token to req.requestAccessToken and calls next() on success', async () => {
      const introspect = vi.fn().mockResolvedValue({ active: true })
      const middleware = createMcpAuthMiddleware({
        oauth: { introspectToken: introspect },
        accessToken: null,
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })
      mockExtractBearerToken.mockReturnValue('good-token')

      await middleware(mockReq, mockRes, mockNext)

      expect(mockReq.requestAccessToken).toBe('good-token')
      expect(mockNext).toHaveBeenCalledTimes(1)
      expect(mockRes.status).not.toHaveBeenCalled()
    })
  })

  describe('token mode', () => {
    it('attaches the static token to req.requestAccessToken and calls next()', async () => {
      const middleware = createMcpAuthMiddleware({
        oauth: null,
        accessToken: 'static-token',
        baseUrl: 'https://example.com',
        serviceName: 'svc'
      })

      await middleware(mockReq, mockRes, mockNext)

      expect(mockReq.requestAccessToken).toBe('static-token')
      expect(mockNext).toHaveBeenCalledTimes(1)
      expect(mockExtractBearerToken).not.toHaveBeenCalled()
    })
  })
})
