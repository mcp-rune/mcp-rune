/**
 * OAuth2 Service Tests
 *
 * Tests constructor, buildAuthorizationUrl, refreshAccessToken,
 * getUserInfo, getClientCredentialsToken, revokeToken, introspectToken,
 * and getValidAccessToken.
 *
 * Note: startLocalAuthFlow and handleRemoteCallback are integration-heavy
 * (HTTP server, browser open) and tested separately if needed.
 */

// Mock openid-client
vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  randomPKCECodeVerifier: vi.fn(() => 'test-verifier'),
  randomState: vi.fn(() => 'test-state'),
  calculatePKCECodeChallenge: vi.fn(async () => 'test-challenge'),
  authorizationCodeGrant: vi.fn(),
  refreshTokenGrant: vi.fn(),
  clientCredentialsGrant: vi.fn(),
  fetchUserInfo: vi.fn(),
  tokenRevocation: vi.fn(),
  tokenIntrospection: vi.fn(),
  skipSubjectCheck: Symbol('skipSubjectCheck'),
  allowInsecureRequests: Symbol('allowInsecureRequests')
}))

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('../../../src/oauth2/token-store.js', () => ({
  storeTokens: vi.fn(),
  getTokensBySession: vi.fn()
}))

import * as client from 'openid-client'

import { OAuthService } from '../../../src/oauth2/service.js'
import * as tokenStore from '../../../src/oauth2/token-store.js'

const defaultOptions = {
  authServerUrl: 'http://localhost:4000',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3456/callback',
  scopes: 'read write'
}

describe('lib/oauth2/service', () => {
  let oauth

  beforeEach(() => {
    vi.clearAllMocks()
    oauth = new OAuthService(defaultOptions)
  })

  describe('constructor', () => {
    it('stores configuration', () => {
      expect(oauth.authServerUrl).toBe(defaultOptions.authServerUrl)
      expect(oauth.clientId).toBe(defaultOptions.clientId)
      expect(oauth.clientSecret).toBe(defaultOptions.clientSecret)
      expect(oauth.redirectUri).toBe(defaultOptions.redirectUri)
      expect(oauth.scopes).toBe('read write')
      expect(oauth.resourceUri).toBeNull()
    })

    it('defaults scopes to read write', () => {
      const svc = new OAuthService({ ...defaultOptions, scopes: undefined })
      expect(svc.scopes).toBe('read write')
    })

    it('accepts resourceUri', () => {
      const svc = new OAuthService({ ...defaultOptions, resourceUri: 'https://mcp.example.com' })
      expect(svc.resourceUri).toBe('https://mcp.example.com')
    })

    it('rejects resourceUri with fragment (RFC 8707)', () => {
      expect(
        () => new OAuthService({ ...defaultOptions, resourceUri: 'https://mcp.example.com#frag' })
      ).toThrow('MUST NOT include a fragment')
    })

    it('rejects resourceUri with query component (RFC 8707)', () => {
      expect(
        () => new OAuthService({ ...defaultOptions, resourceUri: 'https://mcp.example.com?q=1' })
      ).toThrow('SHOULD NOT include a query')
    })

    it('rejects relative resourceUri (RFC 8707)', () => {
      expect(() => new OAuthService({ ...defaultOptions, resourceUri: '/not-absolute' })).toThrow(
        'must be an absolute URI'
      )
    })

    it('throws on HTTP identity URL in production', () => {
      expect(
        () =>
          new OAuthService({
            ...defaultOptions,
            isProduction: true
          })
      ).toThrow('Security Error')
    })

    it('allows HTTPS in production', () => {
      const svc = new OAuthService({
        ...defaultOptions,
        authServerUrl: 'https://identity.example.com',
        isProduction: true
      })
      expect(svc._isInsecure).toBe(false)
    })

    it('marks HTTP URL as insecure', () => {
      expect(oauth._isInsecure).toBe(true)
    })
  })

  // HttpServer calls this so the OAuth proxy's RFC 8707 `resource` injection
  // and OAuthService's introspection audience check share the same value.
  // The method must be idempotent (multiple wires-up shouldn't change a
  // caller-supplied value) and must reject invalid URIs (otherwise the
  // validation guarantees from the constructor would no longer hold).
  describe('applyDefaultResourceUri', () => {
    it('sets resourceUri when it was unset at construction', () => {
      const svc = new OAuthService(defaultOptions)
      expect(svc.resourceUri).toBeNull()

      svc.applyDefaultResourceUri('https://mcp.example.com/mcp')

      expect(svc.resourceUri).toBe('https://mcp.example.com/mcp')
    })

    it('does not overwrite a caller-supplied resourceUri', () => {
      const svc = new OAuthService({
        ...defaultOptions,
        resourceUri: 'https://mcp.example.com/api/v2/mcp'
      })

      svc.applyDefaultResourceUri('https://mcp.example.com/mcp')

      expect(svc.resourceUri).toBe('https://mcp.example.com/api/v2/mcp')
    })

    it('validates the default value per RFC 8707', () => {
      const svc = new OAuthService(defaultOptions)
      expect(() => svc.applyDefaultResourceUri('https://mcp.example.com#frag')).toThrow(
        'MUST NOT include a fragment'
      )
      expect(svc.resourceUri).toBeNull()
    })
  })

  describe('_getExecuteOptions', () => {
    it('returns allowInsecureRequests for HTTP URLs', () => {
      const opts = oauth._getExecuteOptions()
      expect(opts).toEqual([client.allowInsecureRequests])
    })

    it('returns undefined for HTTPS URLs', () => {
      const svc = new OAuthService({
        ...defaultOptions,
        authServerUrl: 'https://identity.example.com'
      })
      expect(svc._getExecuteOptions()).toBeUndefined()
    })
  })

  describe('getConfig', () => {
    it('discovers OpenID Connect configuration', async () => {
      const mockConfig = { issuer: 'http://localhost:4000' }
      client.discovery.mockResolvedValue(mockConfig)

      const config = await oauth.getConfig()

      expect(config).toBe(mockConfig)
      expect(client.discovery).toHaveBeenCalledOnce()
    })

    it('caches configuration on subsequent calls', async () => {
      const mockConfig = { issuer: 'http://localhost:4000' }
      client.discovery.mockResolvedValue(mockConfig)

      await oauth.getConfig()
      await oauth.getConfig()

      expect(client.discovery).toHaveBeenCalledOnce()
    })

    it('re-throws discovery errors', async () => {
      client.discovery.mockRejectedValue(new Error('Network error'))

      await expect(oauth.getConfig()).rejects.toThrow('Network error')
    })
  })

  describe('buildAuthorizationUrl', () => {
    it('builds URL with PKCE parameters', () => {
      const mockConfig = {}
      const mockUrl = new URL('http://localhost:4000/authorize?code=test')
      client.buildAuthorizationUrl.mockReturnValue(mockUrl)

      const url = oauth.buildAuthorizationUrl(mockConfig, 'challenge-123', 'state-456')

      expect(client.buildAuthorizationUrl).toHaveBeenCalledWith(mockConfig, {
        redirect_uri: defaultOptions.redirectUri,
        scope: 'read write',
        code_challenge: 'challenge-123',
        code_challenge_method: 'S256',
        state: 'state-456'
      })
      expect(url).toBe(mockUrl)
    })

    it('includes resource parameter when resourceUri is set', () => {
      const svc = new OAuthService({ ...defaultOptions, resourceUri: 'https://mcp.example.com' })
      client.buildAuthorizationUrl.mockReturnValue(new URL('http://localhost'))

      svc.buildAuthorizationUrl({}, 'challenge', 'state')

      const params = client.buildAuthorizationUrl.mock.calls[0][1]
      expect(params.resource).toBe('https://mcp.example.com')
    })
  })

  describe('getAuthorizationUrlForRemote', () => {
    it('returns authUrl, codeVerifier, and state', async () => {
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      const mockUrl = new URL('http://localhost:4000/authorize')
      client.buildAuthorizationUrl.mockReturnValue(mockUrl)

      const result = await oauth.getAuthorizationUrlForRemote()

      expect(result.authUrl).toBe(mockUrl)
      expect(result.codeVerifier).toBe('test-verifier')
      expect(result.state).toBe('test-state')
    })
  })

  describe('refreshAccessToken', () => {
    it('refreshes and returns new tokens', async () => {
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      client.refreshTokenGrant.mockResolvedValue({
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_in: 3600,
        scope: 'read write'
      })

      const result = await oauth.refreshAccessToken('old-refresh-token')

      expect(client.refreshTokenGrant).toHaveBeenCalledWith(
        mockConfig,
        'old-refresh-token',
        undefined
      )
      expect(result.access_token).toBe('new-at')
      expect(result.refresh_token).toBe('new-rt')
      expect(result.expires_in).toBe(3600)
    })

    it('includes resource parameter when resourceUri is configured (RFC 8707)', async () => {
      const svc = new OAuthService({
        ...defaultOptions,
        resourceUri: 'https://mcp.example.com/mcp'
      })
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      client.refreshTokenGrant.mockResolvedValue({
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_in: 3600,
        scope: 'read write'
      })

      await svc.refreshAccessToken('old-refresh-token')

      expect(client.refreshTokenGrant).toHaveBeenCalledWith(mockConfig, 'old-refresh-token', {
        resource: 'https://mcp.example.com/mcp'
      })
    })
  })

  describe('getUserInfo', () => {
    it('fetches user info with skipSubjectCheck', async () => {
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      const userInfo = { sub: '123', email: 'test@example.com' }
      client.fetchUserInfo.mockResolvedValue(userInfo)

      const result = await oauth.getUserInfo('access-token')

      expect(client.fetchUserInfo).toHaveBeenCalledWith(
        mockConfig,
        'access-token',
        client.skipSubjectCheck
      )
      expect(result).toEqual(userInfo)
    })
  })

  describe('getClientCredentialsToken', () => {
    it('requests token with client credentials grant', async () => {
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      client.clientCredentialsGrant.mockResolvedValue({
        access_token: 'cc-token',
        expires_in: 7200,
        token_type: 'Bearer',
        scope: 'read write'
      })

      const result = await oauth.getClientCredentialsToken()

      expect(client.clientCredentialsGrant).toHaveBeenCalledWith(mockConfig, {
        scope: 'read write'
      })
      expect(result.access_token).toBe('cc-token')
      expect(result.token_type).toBe('Bearer')
    })

    it('includes resource parameter when resourceUri is configured (RFC 8707)', async () => {
      const svc = new OAuthService({
        ...defaultOptions,
        resourceUri: 'https://mcp.example.com/mcp'
      })
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      client.clientCredentialsGrant.mockResolvedValue({
        access_token: 'cc-token',
        expires_in: 7200,
        token_type: 'Bearer',
        scope: 'read write'
      })

      await svc.getClientCredentialsToken()

      expect(client.clientCredentialsGrant).toHaveBeenCalledWith(mockConfig, {
        scope: 'read write',
        resource: 'https://mcp.example.com/mcp'
      })
    })

    it('defaults token_type to Bearer', async () => {
      client.discovery.mockResolvedValue({})
      client.clientCredentialsGrant.mockResolvedValue({
        access_token: 'cc-token',
        expires_in: 7200
      })

      const result = await oauth.getClientCredentialsToken()
      expect(result.token_type).toBe('Bearer')
    })
  })

  describe('revokeToken', () => {
    it('revokes the token', async () => {
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)

      await oauth.revokeToken('token-to-revoke')

      expect(client.tokenRevocation).toHaveBeenCalledWith(mockConfig, 'token-to-revoke')
    })

    it('clears introspection cache entry for the revoked token', async () => {
      client.discovery.mockResolvedValue({})
      client.tokenRevocation.mockResolvedValue(undefined)

      // Populate cache with the token
      oauth._cacheIntrospection('token-to-revoke', { active: true, sub: 'user-1' })
      expect(oauth._introspectionCache.has('token-to-revoke')).toBe(true)

      await oauth.revokeToken('token-to-revoke')

      expect(oauth._introspectionCache.has('token-to-revoke')).toBe(false)
    })

    it('does not affect other cached tokens on revocation', async () => {
      client.discovery.mockResolvedValue({})
      client.tokenRevocation.mockResolvedValue(undefined)

      oauth._cacheIntrospection('token-to-revoke', { active: true })
      oauth._cacheIntrospection('other-token', { active: true })

      await oauth.revokeToken('token-to-revoke')

      expect(oauth._introspectionCache.has('token-to-revoke')).toBe(false)
      expect(oauth._introspectionCache.has('other-token')).toBe(true)
    })
  })

  describe('introspectToken', () => {
    it('introspects token and caches result', async () => {
      const mockConfig = {}
      client.discovery.mockResolvedValue(mockConfig)
      const introspectionResult = { active: true, sub: 'user-1' }
      client.tokenIntrospection.mockResolvedValue(introspectionResult)

      const result = await oauth.introspectToken('my-token')

      expect(result).toEqual(introspectionResult)
      expect(oauth._introspectionCache.size).toBe(1)
    })

    it('returns cached result within TTL', async () => {
      client.discovery.mockResolvedValue({})
      client.tokenIntrospection.mockResolvedValue({ active: true })

      await oauth.introspectToken('my-token')
      const result = await oauth.introspectToken('my-token')

      expect(client.tokenIntrospection).toHaveBeenCalledOnce()
      expect(result).toEqual({ active: true })
    })

    it('returns inactive on introspection error', async () => {
      client.discovery.mockResolvedValue({})
      client.tokenIntrospection.mockRejectedValue(new Error('Network error'))

      const result = await oauth.introspectToken('bad-token')

      expect(result).toEqual({ active: false })
    })
  })

  describe('getValidAccessToken', () => {
    it('returns null when no tokens found', async () => {
      tokenStore.getTokensBySession.mockResolvedValue(null)

      const result = await oauth.getValidAccessToken('session-1')
      expect(result).toBeNull()
    })

    it('returns access token when not expired', async () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000) // 30 min from now
      tokenStore.getTokensBySession.mockResolvedValue({
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: futureDate.toISOString()
      })

      const result = await oauth.getValidAccessToken('session-1')
      expect(result).toBe('valid-token')
    })

    it('refreshes token when about to expire', async () => {
      const soonDate = new Date(Date.now() + 2 * 60 * 1000) // 2 min (within 5 min buffer)
      tokenStore.getTokensBySession.mockResolvedValue({
        userId: 'user-1',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: soonDate.toISOString()
      })

      client.discovery.mockResolvedValue({})
      client.refreshTokenGrant.mockResolvedValue({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        scope: 'read write'
      })

      const result = await oauth.getValidAccessToken('session-1')

      expect(result).toBe('new-token')
      expect(tokenStore.storeTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          accessToken: 'new-token',
          refreshToken: 'new-refresh'
        })
      )
    })

    it('returns null when expired with no refresh token', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000)
      tokenStore.getTokensBySession.mockResolvedValue({
        accessToken: 'expired-token',
        refreshToken: null,
        expiresAt: pastDate.toISOString()
      })

      const result = await oauth.getValidAccessToken('session-1')
      expect(result).toBeNull()
    })

    it('returns null when refresh fails', async () => {
      const soonDate = new Date(Date.now() + 2 * 60 * 1000)
      tokenStore.getTokensBySession.mockResolvedValue({
        userId: 'user-1',
        accessToken: 'old-token',
        refreshToken: 'bad-refresh',
        expiresAt: soonDate.toISOString()
      })

      client.discovery.mockResolvedValue({})
      client.refreshTokenGrant.mockRejectedValue(new Error('Invalid refresh token'))

      const result = await oauth.getValidAccessToken('session-1')
      expect(result).toBeNull()
    })

    it('preserves old refresh token when new one is not returned', async () => {
      const soonDate = new Date(Date.now() + 2 * 60 * 1000)
      tokenStore.getTokensBySession.mockResolvedValue({
        userId: 'user-1',
        accessToken: 'old-token',
        refreshToken: 'original-refresh',
        expiresAt: soonDate.toISOString()
      })

      client.discovery.mockResolvedValue({})
      client.refreshTokenGrant.mockResolvedValue({
        access_token: 'new-token',
        refresh_token: null,
        expires_in: 3600,
        scope: 'read write'
      })

      await oauth.getValidAccessToken('session-1')

      expect(tokenStore.storeTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: 'original-refresh'
        })
      )
    })
  })
})
