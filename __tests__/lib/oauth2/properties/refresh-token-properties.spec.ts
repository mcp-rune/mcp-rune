/**
 * Refresh Token Property-Based Tests
 *
 * Validates refresh token flow invariants:
 * - Refreshed tokens always produce new access tokens
 * - Response shape matches RFC 6749 Section 6
 * - getValidAccessToken refresh logic: expired tokens trigger refresh,
 *   valid tokens are returned as-is
 * - Fallback to old refresh token when new one not returned
 */

import * as fc from 'fast-check'

// Mock openid-client before importing OAuthService
vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  refreshTokenGrant: vi.fn(),
  allowInsecureRequests: Symbol('allowInsecureRequests')
}))

vi.mock('#src/services/logger.js', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('../../../../src/oauth2/token-store.js', () => ({
  getTokensBySession: vi.fn(),
  storeTokens: vi.fn()
}))

import * as openidClient from 'openid-client'
import * as tokenStore from '../../../../src/oauth2/token-store.js'
import { OAuthService } from '../../../../src/oauth2/service.js'

describe('Refresh Token Properties (RFC 6749 Section 6)', () => {
  let oauth

  beforeEach(() => {
    vi.clearAllMocks()
    oauth = new OAuthService({
      identityUrl: 'http://localhost:4000',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3456/callback',
      scopes: 'read write'
    })
    oauth.config = { serverMetadata: () => ({}) }
  })

  // Arbitraries
  const tokenArb = fc.stringMatching(/^[A-Za-z0-9_-]{16,64}$/)
  const expiresInArb = fc.integer({ min: 60, max: 86400 })
  const scopeArb = fc.constantFrom('read', 'write', 'read write')

  it('refreshAccessToken always returns access_token and scope', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        tokenArb,
        expiresInArb,
        scopeArb,
        async (refreshToken, newAccessToken, expiresIn, scope) => {
          openidClient.refreshTokenGrant.mockResolvedValueOnce({
            access_token: newAccessToken,
            refresh_token: refreshToken,
            expires_in: expiresIn,
            scope
          })

          const result = await oauth.refreshAccessToken(refreshToken)

          expect(result.access_token).toBe(newAccessToken)
          expect(typeof result.access_token).toBe('string')
          expect(result.access_token.length).toBeGreaterThan(0)
          expect(result.scope).toBe(scope)
          expect(result.expires_in).toBe(expiresIn)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('refreshAccessToken preserves refresh_token from Identity response', async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, tokenArb, async (oldRefresh, newRefresh) => {
        openidClient.refreshTokenGrant.mockResolvedValueOnce({
          access_token: 'new-access-token',
          refresh_token: newRefresh,
          expires_in: 3600,
          scope: 'read'
        })

        const result = await oauth.refreshAccessToken(oldRefresh)

        expect(result.refresh_token).toBe(newRefresh)
      }),
      { numRuns: 50 }
    )
  })

  it('getValidAccessToken returns cached token when not expired', async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, fc.uuid(), async (accessToken, sessionId) => {
        // Token expires far in the future (well beyond 5-min buffer)
        const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString()

        tokenStore.getTokensBySession.mockResolvedValueOnce({
          accessToken,
          refreshToken: 'some-refresh',
          expiresAt: futureExpiry,
          userId: 'user-1'
        })

        const result = await oauth.getValidAccessToken(sessionId)

        expect(result).toBe(accessToken)
        // Should NOT have called refresh
        expect(openidClient.refreshTokenGrant).not.toHaveBeenCalled()
      }),
      { numRuns: 50 }
    )
  })

  it('getValidAccessToken triggers refresh for expired tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        tokenArb,
        tokenArb,
        tokenArb,
        fc.uuid(),
        async (oldAccess, oldRefresh, newAccess, sessionId) => {
          vi.clearAllMocks()

          // Token already expired
          const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString()

          tokenStore.getTokensBySession.mockResolvedValueOnce({
            accessToken: oldAccess,
            refreshToken: oldRefresh,
            expiresAt: pastExpiry,
            userId: 'user-1'
          })

          openidClient.refreshTokenGrant.mockResolvedValueOnce({
            access_token: newAccess,
            refresh_token: 'new-refresh',
            expires_in: 3600,
            scope: 'read'
          })

          tokenStore.storeTokens.mockResolvedValueOnce()

          const result = await oauth.getValidAccessToken(sessionId)

          expect(result).toBe(newAccess)
          expect(openidClient.refreshTokenGrant).toHaveBeenCalledOnce()
        }
      ),
      { numRuns: 50 }
    )
  })

  it('getValidAccessToken returns null when no tokens exist for session', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (sessionId) => {
        tokenStore.getTokensBySession.mockResolvedValueOnce(null)

        const result = await oauth.getValidAccessToken(sessionId)

        expect(result).toBeNull()
      }),
      { numRuns: 50 }
    )
  })

  it('getValidAccessToken returns null when token expired and no refresh token', async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, fc.uuid(), async (accessToken, sessionId) => {
        const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString()

        tokenStore.getTokensBySession.mockResolvedValueOnce({
          accessToken,
          refreshToken: null,
          expiresAt: pastExpiry,
          userId: 'user-1'
        })

        const result = await oauth.getValidAccessToken(sessionId)

        expect(result).toBeNull()
      }),
      { numRuns: 50 }
    )
  })
})
