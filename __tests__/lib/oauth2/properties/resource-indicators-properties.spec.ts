/**
 * Resource Indicators Property-Based Tests
 *
 * Validates RFC 8707 resource indicator invariants:
 * - When resourceUri is configured, the resource parameter is always included
 *   in authorization URLs
 * - When resourceUri is not configured, no resource parameter is present
 * - Resource parameter value always matches the configured resourceUri
 */

import * as fc from 'fast-check'

// Mock openid-client before importing OAuthService
vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn((config, params) => {
    // Simulate openid-client: build a URL from params
    const url = new URL('https://identity.example.com/oauth/authorize')
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
    return url
  }),
  randomPKCECodeVerifier: vi.fn(() => 'mock-verifier'),
  randomState: vi.fn(() => 'mock-state'),
  calculatePKCECodeChallenge: vi.fn(async () => 'mock-challenge'),
  allowInsecureRequests: Symbol('allowInsecureRequests')
}))

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

import { OAuthService } from '../../../../src/oauth2/service.js'

describe('Resource Indicators Properties (RFC 8707)', () => {
  // Arbitrary for resource URIs
  const resourceUriArb = fc
    .tuple(
      fc.constantFrom('https'),
      fc.stringMatching(/^[a-z]{3,10}$/),
      fc.stringMatching(/^[a-z]{3,10}$/),
      fc.constantFrom('/mcp', '/my-mcp-server/mcp', '/api')
    )
    .map(([scheme, sub, domain, path]) => `${scheme}://${sub}.${domain}.com${path}`)

  // Arbitrary for PKCE code challenges
  const codeChallengeArb = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/)

  // Arbitrary for state parameters
  const stateArb = fc.stringMatching(/^[A-Za-z0-9_-]{16,32}$/)

  it('resource parameter is always included when resourceUri is configured', () => {
    fc.assert(
      fc.property(
        resourceUriArb,
        codeChallengeArb,
        stateArb,
        (resourceUri, codeChallenge, state) => {
          const oauth = new OAuthService({
            authServerUrl: 'http://localhost:4000',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            redirectUri: 'http://localhost:3456/callback',
            scopes: 'read write',
            resourceUri
          })

          const mockConfig = { serverMetadata: () => ({}) }
          const url = oauth.buildAuthorizationUrl(mockConfig, codeChallenge, state)

          expect(url.searchParams.get('resource')).toBe(resourceUri)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('resource parameter is never included when resourceUri is not configured', () => {
    fc.assert(
      fc.property(codeChallengeArb, stateArb, (codeChallenge, state) => {
        const oauth = new OAuthService({
          authServerUrl: 'http://localhost:4000',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          redirectUri: 'http://localhost:3456/callback',
          scopes: 'read write'
          // resourceUri intentionally omitted
        })

        const mockConfig = { serverMetadata: () => ({}) }
        const url = oauth.buildAuthorizationUrl(mockConfig, codeChallenge, state)

        expect(url.searchParams.has('resource')).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('PKCE parameters are always included regardless of resource configuration', () => {
    fc.assert(
      fc.property(
        fc.option(resourceUriArb, { nil: undefined }),
        codeChallengeArb,
        stateArb,
        (resourceUri, codeChallenge, state) => {
          const oauth = new OAuthService({
            authServerUrl: 'http://localhost:4000',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            redirectUri: 'http://localhost:3456/callback',
            scopes: 'read write',
            ...(resourceUri ? { resourceUri } : {})
          })

          const mockConfig = { serverMetadata: () => ({}) }
          const url = oauth.buildAuthorizationUrl(mockConfig, codeChallenge, state)

          expect(url.searchParams.get('code_challenge')).toBe(codeChallenge)
          expect(url.searchParams.get('code_challenge_method')).toBe('S256')
          expect(url.searchParams.get('state')).toBe(state)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('constructor rejects resourceUri with fragment component (RFC 8707)', () => {
    fc.assert(
      fc.property(resourceUriArb, fc.stringMatching(/^#[a-z]{1,10}$/), (uri, fragment) => {
        expect(
          () =>
            new OAuthService({
              authServerUrl: 'http://localhost:4000',
              clientId: 'test-client',
              clientSecret: 'test-secret',
              redirectUri: 'http://localhost:3456/callback',
              resourceUri: `${uri}${fragment}`
            })
        ).toThrow('MUST NOT include a fragment')
      }),
      { numRuns: 50 }
    )
  })

  it('constructor rejects resourceUri with query component (RFC 8707)', () => {
    fc.assert(
      fc.property(resourceUriArb, fc.stringMatching(/^\?[a-z]{1,5}=[a-z]{1,5}$/), (uri, query) => {
        expect(
          () =>
            new OAuthService({
              authServerUrl: 'http://localhost:4000',
              clientId: 'test-client',
              clientSecret: 'test-secret',
              redirectUri: 'http://localhost:3456/callback',
              resourceUri: `${uri}${query}`
            })
        ).toThrow('SHOULD NOT include a query')
      }),
      { numRuns: 50 }
    )
  })

  it('authorization URL always includes redirect_uri and scope', () => {
    fc.assert(
      fc.property(
        codeChallengeArb,
        stateArb,
        fc.constantFrom('read', 'write', 'read write', 'openid read write'),
        (codeChallenge, state, scopes) => {
          const oauth = new OAuthService({
            authServerUrl: 'http://localhost:4000',
            clientId: 'test-client',
            clientSecret: 'test-secret',
            redirectUri: 'http://localhost:3456/callback',
            scopes
          })

          const mockConfig = { serverMetadata: () => ({}) }
          const url = oauth.buildAuthorizationUrl(mockConfig, codeChallenge, state)

          expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3456/callback')
          expect(url.searchParams.get('scope')).toBe(scopes)
        }
      ),
      { numRuns: 50 }
    )
  })
})
