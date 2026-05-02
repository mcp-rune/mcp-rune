/**
 * OAuth Router Tests
 *
 * Verifies OAuth route handlers: metadata proxying, token exchange, DCR,
 * callback handling, and authorization redirect.
 *
 * Express middleware pipeline:
 *   1. request-id middleware: sets req.requestId and X-Request-ID response header
 *   2. request-logger middleware: logs "Request started" / "Request completed"
 *   3. Route handlers (this file): handle OAuth proxy logic
 */

// Define mocks using vi.hoisted()
const { mockAxios, mockLogger } = vi.hoisted(() => ({
  mockAxios: {
    get: vi.fn(),
    post: vi.fn()
  },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Mock axios
vi.mock('axios', () => ({
  default: mockAxios
}))

// Mock logger
vi.mock('#src/services/logger.js', () => mockLogger)

import * as logger from '#src/services/logger.js'

import {
  buildResourceMetadataUrl,
  createOAuthRouter,
  extractBearerToken,
  sendUnauthorized
} from '../../../../src/mcp/middleware/oauth-router.js'

describe('lib/mcp/middleware/oauth-router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer authorization header', () => {
      const req = {
        headers: { authorization: 'Bearer abc123token' }
      }
      expect(extractBearerToken(req)).toBe('abc123token')
    })

    it('should return null when no authorization header', () => {
      const req = { headers: {} }
      expect(extractBearerToken(req)).toBeNull()
    })

    it('should return null when authorization header is undefined', () => {
      const req = { headers: { authorization: undefined } }
      expect(extractBearerToken(req)).toBeNull()
    })

    it('should return null when authorization header does not start with Bearer', () => {
      const req = { headers: { authorization: 'Basic abc123' } }
      expect(extractBearerToken(req)).toBeNull()
    })

    it('should return null for lowercase bearer', () => {
      const req = { headers: { authorization: 'bearer abc123' } }
      expect(extractBearerToken(req)).toBeNull()
    })

    it('should handle token with special characters', () => {
      const req = {
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
        }
      }
      expect(extractBearerToken(req)).toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
      )
    })

    it('should return empty string when only "Bearer " is provided', () => {
      const req = { headers: { authorization: 'Bearer ' } }
      expect(extractBearerToken(req)).toBe('')
    })
  })

  describe('buildResourceMetadataUrl', () => {
    it('should build RFC 9728 compliant URL for base path', () => {
      const result = buildResourceMetadataUrl('https://example.com')
      expect(result).toBe('https://example.com/.well-known/oauth-protected-resource/')
    })

    it('should build RFC 9728 compliant URL with path prefix', () => {
      const result = buildResourceMetadataUrl('https://example.com/my-mcp-server/mcp')
      expect(result).toBe(
        'https://example.com/.well-known/oauth-protected-resource/my-mcp-server/mcp'
      )
    })

    it('should handle URL with port', () => {
      const result = buildResourceMetadataUrl('http://localhost:3000/mcp')
      expect(result).toBe('http://localhost:3000/.well-known/oauth-protected-resource/mcp')
    })

    it('should handle URL with trailing slash', () => {
      const result = buildResourceMetadataUrl('https://example.com/api/')
      expect(result).toBe('https://example.com/.well-known/oauth-protected-resource/api/')
    })

    it('should preserve protocol (http vs https)', () => {
      const httpResult = buildResourceMetadataUrl('http://example.com/mcp')
      expect(httpResult).toBe('http://example.com/.well-known/oauth-protected-resource/mcp')

      const httpsResult = buildResourceMetadataUrl('https://example.com/mcp')
      expect(httpsResult).toBe('https://example.com/.well-known/oauth-protected-resource/mcp')
    })
  })

  describe('sendUnauthorized', () => {
    let mockReq
    let mockRes

    beforeEach(() => {
      mockReq = { path: '/mcp' }
      mockRes = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }
    })

    it('should set WWW-Authenticate header with resource_metadata URL', () => {
      sendUnauthorized(mockReq, mockRes, 'https://example.com')

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"'
      )
    })

    it('should return 401 status', () => {
      sendUnauthorized(mockReq, mockRes, 'https://example.com')

      expect(mockRes.status).toHaveBeenCalledWith(401)
    })

    it('should return JSON error response', () => {
      sendUnauthorized(mockReq, mockRes, 'https://example.com')

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        error_description:
          'Authentication required. See WWW-Authenticate header for authorization server details.'
      })
    })

    it('should use base URL for non-mcp endpoints', () => {
      mockReq.path = '/oauth/token'

      sendUnauthorized(mockReq, mockRes, 'https://example.com')

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/"'
      )
    })

    it('should handle path prefix in baseUrl', () => {
      mockReq.path = '/my-mcp-server/mcp'

      sendUnauthorized(mockReq, mockRes, 'https://example.com/my-mcp-server')

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/my-mcp-server/mcp"'
      )
    })
  })

  describe('createOAuthRouter', () => {
    let mockOauth
    let router
    let mockReq
    let mockRes
    let mockNext

    beforeEach(() => {
      mockOauth = {
        authServerUrl: 'https://identity.example.com',
        scopes: 'read',
        getClientCredentialsToken: vi.fn()
      }

      router = createOAuthRouter({
        oauth: mockOauth,
        baseUrl: 'https://mcp.example.com',
        mcpName: 'test-mcp'
      })

      mockRes = {
        json: vi.fn(),
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        redirect: vi.fn()
      }

      mockNext = vi.fn()
    })

    it('should return an Express router', () => {
      expect(router).toBeDefined()
      expect(typeof router).toBe('function')
    })

    describe('GET /.well-known/oauth-protected-resource', () => {
      it('should return resource metadata', () => {
        const handler = findRouteHandler(router, 'get', '/.well-known/oauth-protected-resource')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith({
          resource: 'https://mcp.example.com/mcp',
          authorization_servers: ['https://mcp.example.com']
        })
      })

      // RFC 9728 §3.1: path-inserted form is the canonical metadata URL for a
      // resource with a non-root path. The server must serve it so that strict
      // clients following the `resource_metadata` parameter in WWW-Authenticate
      // do not 404. See `docs/oauth2-discovery-flow.md`.
      it('should also serve the RFC 9728 §3.1 path-inserted form at /.well-known/oauth-protected-resource/mcp', () => {
        const handler = findRouteHandler(router, 'get', '/.well-known/oauth-protected-resource/mcp')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith({
          resource: 'https://mcp.example.com/mcp',
          authorization_servers: ['https://mcp.example.com']
        })
      })
    })

    describe('GET /.well-known/oauth-authorization-server', () => {
      it('should proxy and rewrite authorization server metadata', async () => {
        mockAxios.get.mockResolvedValue({
          data: {
            issuer: 'https://identity.example.com',
            authorization_endpoint: 'https://identity.example.com/oauth/authorize',
            token_endpoint: 'https://identity.example.com/oauth/token',
            registration_endpoint: 'https://identity.example.com/oauth/register',
            revocation_endpoint: 'https://identity.example.com/oauth/revoke',
            introspection_endpoint: 'https://identity.example.com/oauth/introspect'
          }
        })

        const handler = findRouteHandler(router, 'get', '/.well-known/oauth-authorization-server')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockAxios.get).toHaveBeenCalledWith(
          'https://identity.example.com/.well-known/oauth-authorization-server'
        )

        expect(mockRes.json).toHaveBeenCalledWith({
          issuer: 'https://identity.example.com',
          authorization_endpoint: 'https://mcp.example.com/oauth/authorize',
          token_endpoint: 'https://mcp.example.com/oauth/token',
          registration_endpoint: 'https://mcp.example.com/oauth/register',
          revocation_endpoint: 'https://identity.example.com/oauth/revoke',
          introspection_endpoint: 'https://identity.example.com/oauth/introspect'
        })
      })

      it('should return 502 when authorization server is unreachable', async () => {
        mockAxios.get.mockRejectedValue(new Error('Connection refused'))

        const handler = findRouteHandler(router, 'get', '/.well-known/oauth-authorization-server')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(502)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'Failed to fetch authorization server metadata'
        })
        expect(logger.error).toHaveBeenCalled()
      })
    })

    describe('GET /.well-known/openid-configuration', () => {
      it('should proxy and rewrite openid configuration', async () => {
        mockAxios.get.mockResolvedValue({
          data: {
            issuer: 'https://identity.example.com',
            authorization_endpoint: 'https://identity.example.com/oauth/authorize',
            token_endpoint: 'https://identity.example.com/oauth/token',
            registration_endpoint: 'https://identity.example.com/oauth/register'
          }
        })

        const handler = findRouteHandler(router, 'get', '/.well-known/openid-configuration')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.json).toHaveBeenCalledWith({
          issuer: 'https://identity.example.com',
          authorization_endpoint: 'https://mcp.example.com/oauth/authorize',
          token_endpoint: 'https://mcp.example.com/oauth/token',
          registration_endpoint: 'https://mcp.example.com/oauth/register'
        })
      })
    })

    describe('GET /oauth/callback', () => {
      it('should show success page when no error', async () => {
        const handler = findRouteHandler(router, 'get', '/oauth/callback')
        mockReq = { query: {} }

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.send).toHaveBeenCalledWith(
          expect.stringContaining('Authentication Successful')
        )
        expect(logger.info).toHaveBeenCalledWith('OAuth2 callback successful', {
          service: 'test-mcp'
        })
      })

      it('should show error page when error in query', async () => {
        const handler = findRouteHandler(router, 'get', '/oauth/callback')
        mockReq = {
          query: {
            error: 'access_denied',
            error_description: 'User denied access'
          }
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Authentication Failed'))
        expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('User denied access'))
        expect(logger.error).toHaveBeenCalled()
      })

      it('should show error code when no description provided', async () => {
        const handler = findRouteHandler(router, 'get', '/oauth/callback')
        mockReq = {
          query: { error: 'server_error' }
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('server_error'))
      })
    })

    describe('GET /oauth/authorize', () => {
      it('should redirect to authorization server with query params', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/authorize')
        mockReq = {
          query: {
            client_id: 'my-client',
            redirect_uri: 'https://app.example.com/callback',
            response_type: 'code',
            scope: 'read write'
          }
        }

        handler(mockReq, mockRes)

        expect(mockRes.redirect).toHaveBeenCalledWith(
          expect.stringContaining('https://identity.example.com/oauth/authorize')
        )
        expect(mockRes.redirect).toHaveBeenCalledWith(
          expect.stringContaining('client_id=my-client')
        )
        expect(mockRes.redirect).toHaveBeenCalledWith(expect.stringContaining('response_type=code'))
        expect(logger.info).toHaveBeenCalledWith(
          'Redirecting OAuth authorize to authorization server',
          expect.objectContaining({ clientId: 'my-client' })
        )
      })
    })

    describe('POST /oauth/token', () => {
      it('should proxy token request to authorization server', async () => {
        mockAxios.post.mockResolvedValue({
          data: {
            access_token: 'new-token',
            token_type: 'Bearer',
            expires_in: 3600
          }
        })

        const handler = findRouteHandler(router, 'post', '/oauth/token')
        mockReq = {
          body: {
            grant_type: 'authorization_code',
            code: 'auth-code'
          },
          headers: {
            'content-type': 'application/x-www-form-urlencoded'
          }
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockAxios.post).toHaveBeenCalledWith(
          'https://identity.example.com/oauth/token',
          mockReq.body,
          expect.objectContaining({
            headers: expect.objectContaining({
              'Content-Type': 'application/x-www-form-urlencoded'
            })
          })
        )

        expect(mockRes.json).toHaveBeenCalledWith({
          access_token: 'new-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      })

      it('should forward authorization header if present', async () => {
        mockAxios.post.mockResolvedValue({ data: { access_token: 'token' } })

        const handler = findRouteHandler(router, 'post', '/oauth/token')
        mockReq = {
          body: { grant_type: 'client_credentials' },
          headers: {
            'content-type': 'application/json',
            authorization: 'Basic Y2xpZW50OnNlY3JldA=='
          }
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockAxios.post).toHaveBeenCalledWith(
          'https://identity.example.com/oauth/token',
          mockReq.body,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Basic Y2xpZW50OnNlY3JldA=='
            })
          })
        )
      })

      it('should forward error status from authorization server', async () => {
        mockAxios.post.mockRejectedValue({
          response: {
            status: 400,
            data: { error: 'invalid_grant', error_description: 'Code expired' }
          }
        })

        const handler = findRouteHandler(router, 'post', '/oauth/token')
        mockReq = {
          body: { grant_type: 'authorization_code', code: 'expired-code' },
          headers: {}
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'invalid_grant',
          error_description: 'Code expired'
        })
      })

      it('should return 500 for network errors', async () => {
        mockAxios.post.mockRejectedValue(new Error('Network error'))

        const handler = findRouteHandler(router, 'post', '/oauth/token')
        mockReq = {
          body: { grant_type: 'authorization_code' },
          headers: {}
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(500)
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'server_error' })
      })
    })

    describe('POST /oauth/register', () => {
      it('should proxy DCR request to authorization server', async () => {
        mockAxios.post.mockResolvedValue({
          status: 201,
          data: {
            client_id: 'new-client-id',
            client_secret: 'new-client-secret'
          }
        })

        const handler = findRouteHandler(router, 'post', '/oauth/register')
        mockReq = {
          body: {
            client_name: 'My App',
            redirect_uris: ['https://app.example.com/callback']
          },
          headers: {}
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockAxios.post).toHaveBeenCalledWith(
          'https://identity.example.com/oauth/register',
          mockReq.body,
          expect.objectContaining({
            headers: { 'Content-Type': 'application/json' }
          })
        )

        expect(mockRes.status).toHaveBeenCalledWith(201)
        expect(mockRes.json).toHaveBeenCalledWith({
          client_id: 'new-client-id',
          client_secret: 'new-client-secret'
        })
      })

      it('should forward authorization header if present', async () => {
        mockAxios.post.mockResolvedValue({ status: 201, data: {} })

        const handler = findRouteHandler(router, 'post', '/oauth/register')
        mockReq = {
          body: { client_name: 'App' },
          headers: { authorization: 'Bearer admin-token' }
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockAxios.post).toHaveBeenCalledWith(
          'https://identity.example.com/oauth/register',
          mockReq.body,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer admin-token'
            })
          })
        )
      })

      it('should forward error status from authorization server', async () => {
        mockAxios.post.mockRejectedValue({
          response: {
            status: 400,
            data: { error: 'invalid_client_metadata' }
          }
        })

        const handler = findRouteHandler(router, 'post', '/oauth/register')
        mockReq = {
          body: { client_name: '' },
          headers: {}
        }

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(400)
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'invalid_client_metadata' })
      })
    })

    describe('GET /oauth/client-metadata.json (CIMD)', () => {
      it('should return valid metadata document with correct client_id', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            client_id: 'https://mcp.example.com/oauth/client-metadata.json'
          })
        )
      })

      it('should fall back to mcpName for client_name when no config', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            client_name: 'test-mcp'
          })
        )
      })

      it('should use clientName from config when provided', () => {
        const routerWithConfig = createOAuthRouter({
          oauth: mockOauth,
          baseUrl: 'https://mcp.example.com',
          mcpName: 'test-mcp',
          clientMetadata: {
            redirectUris: ['https://app.example.com/callback'],
            clientName: 'My Custom App'
          }
        })

        const handler = findRouteHandler(routerWithConfig, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            client_name: 'My Custom App'
          })
        )
      })

      it('should use redirectUris from config when provided', () => {
        const routerWithConfig = createOAuthRouter({
          oauth: mockOauth,
          baseUrl: 'https://mcp.example.com',
          mcpName: 'test-mcp',
          clientMetadata: {
            redirectUris: ['https://app.example.com/callback', 'https://app.example.com/cb2']
          }
        })

        const handler = findRouteHandler(routerWithConfig, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            redirect_uris: ['https://app.example.com/callback', 'https://app.example.com/cb2']
          })
        )
      })

      it('should fall back to baseUrl callback when no config', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            redirect_uris: ['https://mcp.example.com/oauth/callback']
          })
        )
      })

      it('should use scope from config when provided', () => {
        const routerWithConfig = createOAuthRouter({
          oauth: mockOauth,
          baseUrl: 'https://mcp.example.com',
          mcpName: 'test-mcp',
          clientMetadata: {
            redirectUris: ['https://app.example.com/callback'],
            scope: 'read write admin'
          }
        })

        const handler = findRouteHandler(routerWithConfig, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            scope: 'read write admin'
          })
        )
      })

      it('should return response with correct structure', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        const response = mockRes.json.mock.calls[0][0]
        expect(response).toEqual({
          client_id: 'https://mcp.example.com/oauth/client-metadata.json',
          client_name: 'test-mcp',
          redirect_uris: ['https://mcp.example.com/oauth/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'read'
        })
      })

      it('should log the request', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(logger.info).toHaveBeenCalledWith('CIMD metadata document requested', {
          service: 'test-mcp',
          clientId: 'https://mcp.example.com/oauth/client-metadata.json'
        })
      })

      it('should set Cache-Control header with default max-age', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600')
      })

      it('should set ETag header', () => {
        const handler = findRouteHandler(router, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.setHeader).toHaveBeenCalledWith(
          'ETag',
          expect.stringMatching(/^"[0-9a-f]{16}"$/)
        )
      })

      it('should use custom cacheMaxAge from config when provided', () => {
        const routerWithConfig = createOAuthRouter({
          oauth: mockOauth,
          baseUrl: 'https://mcp.example.com',
          mcpName: 'test-mcp',
          clientMetadata: {
            redirectUris: ['https://app.example.com/callback'],
            cacheMaxAge: 7200
          }
        })

        const handler = findRouteHandler(routerWithConfig, 'get', '/oauth/client-metadata.json')
        mockReq = {}

        handler(mockReq, mockRes)

        expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=7200')
      })
    })

    describe('POST /mcp/m2m/token', () => {
      it('should return client credentials token', async () => {
        mockOauth.getClientCredentialsToken.mockResolvedValue({
          access_token: 'm2m-token',
          token_type: 'Bearer',
          expires_in: 3600
        })

        const handler = findRouteHandler(router, 'post', '/mcp/m2m/token')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockOauth.getClientCredentialsToken).toHaveBeenCalled()
        expect(mockRes.json).toHaveBeenCalledWith({
          access_token: 'm2m-token',
          token_type: 'Bearer',
          expires_in: 3600
        })
        expect(logger.info).toHaveBeenCalledWith(
          'M2M token issued',
          expect.objectContaining({ expiresIn: 3600 })
        )
      })

      it('should return 401 for invalid_client error', async () => {
        const error = new Error('Client authentication failed')
        error.code = 'invalid_client'
        mockOauth.getClientCredentialsToken.mockRejectedValue(error)

        const handler = findRouteHandler(router, 'post', '/mcp/m2m/token')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(401)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'invalid_client',
          error_description: 'Client authentication failed. Check OAuth2 credentials.'
        })
      })

      it('should return 403 for unauthorized_client error', async () => {
        const error = new Error('Not authorized')
        error.code = 'unauthorized_client'
        mockOauth.getClientCredentialsToken.mockRejectedValue(error)

        const handler = findRouteHandler(router, 'post', '/mcp/m2m/token')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(403)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'unauthorized_client',
          error_description:
            'Client is not authorized for Client Credentials grant. Enable this grant type in authorization server.'
        })
      })

      it('should return 500 for other errors', async () => {
        mockOauth.getClientCredentialsToken.mockRejectedValue(new Error('Network error'))

        const handler = findRouteHandler(router, 'post', '/mcp/m2m/token')
        mockReq = {}

        await handler(mockReq, mockRes, mockNext)

        expect(mockRes.status).toHaveBeenCalledWith(500)
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'server_error',
          error_description: 'Failed to obtain access token'
        })
      })
    })
  })
})

/**
 * Helper to find route handler from Express router
 */
function findRouteHandler(router, method, path) {
  // Express router stores routes in router.stack
  const layer = router.stack.find((layer) => {
    if (!layer.route) return false
    return layer.route.path === path && layer.route.methods[method]
  })

  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  }

  // Return the handler (may be wrapped in asyncHandler)
  const routeHandler = layer.route.stack[0].handle
  return routeHandler
}
