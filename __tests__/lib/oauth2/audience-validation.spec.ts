/**
 * RFC 8707 Audience Validation Tests
 *
 * Verifies that introspectToken() validates the `aud` claim against the
 * configured resourceUri when present, rejecting tokens that were issued
 * for a different resource server.
 */

// Mock openid-client
vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  tokenIntrospection: vi.fn(),
  allowInsecureRequests: Symbol('allowInsecureRequests')
}))

vi.mock('#src/services/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

vi.mock('#src/services/error-tracking.js', () => ({
  captureException: vi.fn(),
  ErrorCategory: { AUTH: 'auth_error' }
}))

vi.mock('../../../src/oauth2/token-store.js', () => ({
  storeTokens: vi.fn(),
  getTokensBySession: vi.fn()
}))

import * as client from 'openid-client'

import { captureException } from '#src/services/error-tracking.js'
import * as logger from '#src/services/logger.js'

import { AudienceMismatchError, OAuthService } from '../../../src/oauth2/service.js'

const RESOURCE_URI = 'https://dsaenz.dev/engineer-mcp/mcp'
const WRONG_RESOURCE = 'https://evil.example.com/mcp'

const baseOptions = {
  authServerUrl: 'http://localhost:4000',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUri: 'http://localhost:3456/callback',
  scopes: 'read write'
}

describe('RFC 8707 Audience Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.discovery.mockResolvedValue({})
  })

  describe('when resourceUri is configured', () => {
    let oauth: InstanceType<typeof OAuthService>

    beforeEach(() => {
      oauth = new OAuthService({ ...baseOptions, resourceUri: RESOURCE_URI })
    })

    it('accepts token with matching aud string', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: RESOURCE_URI
      })

      const result = await oauth.introspectToken('valid-token')

      expect(result.active).toBe(true)
      expect(captureException).not.toHaveBeenCalled()
    })

    it('accepts token with aud array containing resourceUri', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: ['https://other.example.com', RESOURCE_URI]
      })

      const result = await oauth.introspectToken('valid-token')

      expect(result.active).toBe(true)
      expect(captureException).not.toHaveBeenCalled()
    })

    it('rejects token with non-matching aud string', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: WRONG_RESOURCE
      })

      const result = await oauth.introspectToken('wrong-aud-token')

      expect(result.active).toBe(false)
    })

    it('rejects token with aud array not containing resourceUri', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: ['https://other.example.com', WRONG_RESOURCE]
      })

      const result = await oauth.introspectToken('wrong-aud-token')

      expect(result.active).toBe(false)
    })

    it('rejects token with absent aud', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1'
        // no aud field
      })

      const result = await oauth.introspectToken('no-aud-token')

      expect(result.active).toBe(false)
    })

    it('skips validation for inactive tokens', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: false
      })

      const result = await oauth.introspectToken('expired-token')

      expect(result.active).toBe(false)
      expect(captureException).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('error tracking', () => {
    let oauth: InstanceType<typeof OAuthService>

    beforeEach(() => {
      oauth = new OAuthService({ ...baseOptions, resourceUri: RESOURCE_URI })
    })

    it('captures exception with AUTH category on mismatch', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: WRONG_RESOURCE
      })

      await oauth.introspectToken('wrong-aud-token')

      expect(captureException).toHaveBeenCalledOnce()
      const [error, context] = captureException.mock.calls[0]
      expect(error).toBeInstanceOf(AudienceMismatchError)
      expect(error.expectedAudience).toBe(RESOURCE_URI)
      expect(error.actualAudience).toBe(WRONG_RESOURCE)
      expect(context.tags['error.category']).toBe('auth_error')
      expect(context.level).toBe('error')
    })

    it('captures exception with absent aud details', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1'
      })

      await oauth.introspectToken('no-aud-token')

      expect(captureException).toHaveBeenCalledOnce()
      const [error, context] = captureException.mock.calls[0]
      expect(error).toBeInstanceOf(AudienceMismatchError)
      expect(error.actualAudience).toBeUndefined()
      expect(context.extra.actualAudience).toBe('absent')
    })

    it('logs error with expected and actual audience', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: WRONG_RESOURCE
      })

      await oauth.introspectToken('wrong-aud-token')

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('audience mismatch'),
        expect.objectContaining({
          service: 'oauth2',
          expectedAudience: RESOURCE_URI,
          actualAudience: WRONG_RESOURCE
        })
      )
    })
  })

  describe('caching', () => {
    let oauth: InstanceType<typeof OAuthService>

    beforeEach(() => {
      oauth = new OAuthService({ ...baseOptions, resourceUri: RESOURCE_URI })
    })

    it('caches rejected result as inactive', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: WRONG_RESOURCE
      })

      await oauth.introspectToken('wrong-aud-token')

      // Second call should use cache
      const result = await oauth.introspectToken('wrong-aud-token')

      expect(result.active).toBe(false)
      expect(client.tokenIntrospection).toHaveBeenCalledOnce()
      // Error tracking should NOT be called again (cached)
      expect(captureException).toHaveBeenCalledOnce()
    })
  })

  describe('when resourceUri is not configured', () => {
    let oauth: InstanceType<typeof OAuthService>

    beforeEach(() => {
      oauth = new OAuthService(baseOptions) // no resourceUri
    })

    it('accepts token without aud validation', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1'
        // no aud
      })

      const result = await oauth.introspectToken('any-token')

      expect(result.active).toBe(true)
      expect(captureException).not.toHaveBeenCalled()
    })

    it('accepts token with any aud value', async () => {
      client.tokenIntrospection.mockResolvedValue({
        active: true,
        sub: 'user-1',
        aud: 'https://completely-different.example.com'
      })

      const result = await oauth.introspectToken('any-token')

      expect(result.active).toBe(true)
      expect(captureException).not.toHaveBeenCalled()
    })
  })

  describe('AudienceMismatchError', () => {
    it('includes expected and actual audience in message', () => {
      const error = new AudienceMismatchError(RESOURCE_URI, WRONG_RESOURCE)

      expect(error.message).toContain(RESOURCE_URI)
      expect(error.message).toContain(WRONG_RESOURCE)
      expect(error.name).toBe('AudienceMismatchError')
      expect(error.expectedAudience).toBe(RESOURCE_URI)
      expect(error.actualAudience).toBe(WRONG_RESOURCE)
    })

    it('handles absent audience in message', () => {
      const error = new AudienceMismatchError(RESOURCE_URI, undefined)

      expect(error.message).toContain('no aud claim')
      expect(error.actualAudience).toBeUndefined()
    })
  })
})
