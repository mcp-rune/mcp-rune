/**
 * Client Credentials Property-Based Tests
 *
 * Validates client credentials (M2M) token invariants:
 * - Token responses always contain required fields
 * - token_type defaults to Bearer when missing
 * - Response shape conforms to RFC 6749 Section 4.4
 * - No refresh_token is included (per RFC 6749 Section 4.4.3)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// Mock openid-client before importing OAuthService
vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  clientCredentialsGrant: vi.fn(),
  allowInsecureRequests: Symbol('allowInsecureRequests')
}))

vi.mock('#lib/services/logger.js', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

import * as openidClient from 'openid-client'
import { OAuthService } from '../../../../lib/oauth2/service.js'

describe('Client Credentials Properties (RFC 6749 Section 4.4)', () => {
  let oauth

  beforeEach(() => {
    oauth = new OAuthService({
      identityUrl: 'http://localhost:4000',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3456/callback',
      scopes: 'read write'
    })
    // Pre-set config to avoid discovery calls
    oauth.config = { serverMetadata: () => ({}) }
  })

  // Arbitrary for access token strings
  const accessTokenArb = fc.stringMatching(/^[A-Za-z0-9_-]{16,64}$/)

  // Arbitrary for expires_in values (realistic range)
  const expiresInArb = fc.integer({ min: 60, max: 86400 })

  // Arbitrary for scope strings
  const scopeArb = fc.constantFrom('read', 'write', 'read write', 'openid read write')

  it('response always contains access_token and token_type', async () => {
    await fc.assert(
      fc.asyncProperty(accessTokenArb, expiresInArb, scopeArb, async (token, expiresIn, scope) => {
        openidClient.clientCredentialsGrant.mockResolvedValueOnce({
          access_token: token,
          expires_in: expiresIn,
          token_type: 'Bearer',
          scope
        })

        const result = await oauth.getClientCredentialsToken()

        expect(result.access_token).toBe(token)
        expect(result.token_type).toBe('Bearer')
        expect(result.expires_in).toBe(expiresIn)
        expect(result.scope).toBe(scope)
      }),
      { numRuns: 50 }
    )
  })

  it('token_type defaults to Bearer when not provided by Identity', async () => {
    await fc.assert(
      fc.asyncProperty(accessTokenArb, expiresInArb, async (token, expiresIn) => {
        openidClient.clientCredentialsGrant.mockResolvedValueOnce({
          access_token: token,
          expires_in: expiresIn,
          // token_type intentionally omitted
          scope: 'read'
        })

        const result = await oauth.getClientCredentialsToken()

        expect(result.token_type).toBe('Bearer')
      }),
      { numRuns: 50 }
    )
  })

  it('response never contains refresh_token (RFC 6749 Section 4.4.3)', async () => {
    await fc.assert(
      fc.asyncProperty(accessTokenArb, expiresInArb, scopeArb, async (token, expiresIn, scope) => {
        openidClient.clientCredentialsGrant.mockResolvedValueOnce({
          access_token: token,
          expires_in: expiresIn,
          token_type: 'Bearer',
          scope
        })

        const result = await oauth.getClientCredentialsToken()

        expect(result).not.toHaveProperty('refresh_token')
      }),
      { numRuns: 50 }
    )
  })

  it('access_token is always a non-empty string', async () => {
    await fc.assert(
      fc.asyncProperty(accessTokenArb, async (token) => {
        openidClient.clientCredentialsGrant.mockResolvedValueOnce({
          access_token: token,
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'read'
        })

        const result = await oauth.getClientCredentialsToken()

        expect(typeof result.access_token).toBe('string')
        expect(result.access_token.length).toBeGreaterThan(0)
      }),
      { numRuns: 50 }
    )
  })
})
