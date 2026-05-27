/**
 * CIMD extension tests
 *
 * Ported from the previous in-tree CIMD handler tests in
 * __tests__/lib/mcp/middleware/oauth-router.spec.ts. The handler now lives
 * in src/extensions/cimd.ts as an opt-in HttpExtension; these tests exercise
 * the factory + register() contract directly rather than going through the
 * OAuth router.
 */

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('#src/services/logger.js', () => mockLogger)

import { Router } from 'express'

import { cimdExtension } from '../../../src/extensions/cimd.js'

/** Find an Express route handler by method + path */
function findRouteHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method])
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  }
  return layer.route.stack[0].handle
}

describe('lib/extensions/cimd', () => {
  let oauth
  let logger
  let mockRes
  let mockReq

  beforeEach(() => {
    vi.clearAllMocks()
    oauth = {
      scopes: 'read'
    }
    logger = mockLogger
    mockReq = {}
    mockRes = {
      json: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis()
    }
  })

  /**
   * Register the extension with a fresh Router and an overridable ctx,
   * returning the route handler the framework would invoke for
   * GET /oauth/client-metadata.json.
   */
  function registerAndGetHandler(options = {}, ctxOverrides = {}) {
    const ext = cimdExtension(options)
    const router = Router()
    ext.register({
      name: 'cimd',
      router,
      baseUrl: 'https://mcp.example.com',
      pathPrefix: '',
      mcpName: 'test-mcp',
      oauth,
      logger,
      ...ctxOverrides
    })
    return findRouteHandler(router, 'get', '/oauth/client-metadata.json')
  }

  describe('factory', () => {
    it('declares oauth capability requirement', () => {
      const ext = cimdExtension()
      expect(ext.requires).toEqual(['oauth'])
    })

    it('register throws if ctx.oauth is null (defensive)', () => {
      const ext = cimdExtension()
      const router = Router()
      expect(() =>
        ext.register({
          name: 'cimd',
          router,
          baseUrl: 'https://mcp.example.com',
          pathPrefix: '',
          mcpName: 'test-mcp',
          oauth: null,
          logger
        })
      ).toThrow(/oauth is required/)
    })
  })

  describe('GET /oauth/client-metadata.json', () => {
    it('returns metadata document with correct client_id', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'https://mcp.example.com/oauth/client-metadata.json'
        })
      )
    })

    it('falls back to mcpName for client_name when no config', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ client_name: 'test-mcp' })
      )
    })

    it('uses clientName from options when provided', () => {
      const handler = registerAndGetHandler({
        redirectUris: ['https://app.example.com/callback'],
        clientName: 'My Custom App'
      })
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ client_name: 'My Custom App' })
      )
    })

    it('uses redirectUris from options when provided', () => {
      const handler = registerAndGetHandler({
        redirectUris: ['https://app.example.com/callback', 'https://app.example.com/cb2']
      })
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uris: ['https://app.example.com/callback', 'https://app.example.com/cb2']
        })
      )
    })

    it('falls back to baseUrl callback when no redirectUris', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uris: ['https://mcp.example.com/oauth/callback']
        })
      )
    })

    it('uses scope from options when provided', () => {
      const handler = registerAndGetHandler({
        redirectUris: ['https://app.example.com/callback'],
        scope: 'read write admin'
      })
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'read write admin' })
      )
    })

    it('falls back to oauth.scopes for scope when no options.scope', () => {
      oauth.scopes = 'read write'
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ scope: 'read write' }))
    })

    it('returns the full expected response structure', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.json.mock.calls[0][0]).toEqual({
        client_id: 'https://mcp.example.com/oauth/client-metadata.json',
        client_name: 'test-mcp',
        redirect_uris: ['https://mcp.example.com/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'read'
      })
    })

    it('logs the request with service + clientId', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockLogger.info).toHaveBeenCalledWith('CIMD metadata document requested', {
        service: 'test-mcp',
        clientId: 'https://mcp.example.com/oauth/client-metadata.json'
      })
    })

    it('sets Cache-Control header with default max-age=3600', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600')
    })

    it('sets ETag header derived from the body hash', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'ETag',
        expect.stringMatching(/^"[0-9a-f]{16}"$/)
      )
    })

    it('honors custom cacheMaxAge from options', () => {
      const handler = registerAndGetHandler({
        redirectUris: ['https://app.example.com/callback'],
        cacheMaxAge: 7200
      })
      handler(mockReq, mockRes)

      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=7200')
    })

    it('produces a stable ETag across calls with identical body', () => {
      const handler = registerAndGetHandler()
      handler(mockReq, mockRes)
      const firstEtag = mockRes.setHeader.mock.calls.find((c) => c[0] === 'ETag')?.[1]

      const mockRes2 = { json: vi.fn(), setHeader: vi.fn(), status: vi.fn().mockReturnThis() }
      handler(mockReq, mockRes2)
      const secondEtag = mockRes2.setHeader.mock.calls.find((c) => c[0] === 'ETag')?.[1]

      expect(firstEtag).toBe(secondEtag)
    })
  })
})
