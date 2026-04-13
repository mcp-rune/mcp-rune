/**
 * Implementation Interchangeability Property-Based Tests
 *
 * Validates that production and reference OAuth2 implementations
 * maintain interface compatibility across randomized configurations:
 * - Both implementations accept the same configuration shapes
 * - Both expose the same method set
 * - Method arities match between implementations
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

describe('Implementation Interchangeability Properties', () => {
  // Arbitrary for valid OAuth config
  const oauthConfigArb = fc.record({
    identityUrl: fc
      .tuple(fc.stringMatching(/^[a-z]{3,8}$/), fc.integer({ min: 3000, max: 9999 }))
      .map(([host, port]) => `http://${host}:${port}`),
    clientId: fc.stringMatching(/^[a-zA-Z0-9_-]{8,32}$/),
    clientSecret: fc.stringMatching(/^[a-zA-Z0-9_-]{16,64}$/),
    redirectUri: fc
      .integer({ min: 3000, max: 9999 })
      .map((port) => `http://localhost:${port}/callback`),
    scopes: fc.constantFrom('read', 'write', 'read write', 'openid read write')
  })

  // Required interface methods
  const requiredMethods = [
    'getValidAccessToken',
    'startLocalAuthFlow',
    'getAuthorizationUrlForRemote',
    'handleRemoteCallback',
    'getUserInfo',
    'refreshAccessToken'
  ]

  it('both implementations instantiate successfully with random valid configs', async () => {
    const prodModule = await import('#lib/oauth2/service.js')
    const refModule = await import('#lib/oauth2-ref/index.js')

    fc.assert(
      fc.property(oauthConfigArb, (config) => {
        const prodService = new prodModule.OAuthService(config)
        const refService = new refModule.OAuth2ReferenceService(config)

        expect(prodService).toBeDefined()
        expect(refService).toBeDefined()
        expect(prodService.identityUrl).toBe(config.identityUrl)
        expect(refService.identityUrl).toBe(config.identityUrl)
      }),
      { numRuns: 50 }
    )
  })

  it('both implementations expose identical method sets', async () => {
    const prodModule = await import('#lib/oauth2/service.js')
    const refModule = await import('#lib/oauth2-ref/index.js')

    fc.assert(
      fc.property(oauthConfigArb, (config) => {
        const prodService = new prodModule.OAuthService(config)
        const refService = new refModule.OAuth2ReferenceService(config)

        for (const method of requiredMethods) {
          expect(typeof prodService[method]).toBe('function')
          expect(typeof refService[method]).toBe('function')
        }
      }),
      { numRuns: 50 }
    )
  })

  it('method arities match between implementations', async () => {
    const prodModule = await import('#lib/oauth2/service.js')
    const refModule = await import('#lib/oauth2-ref/index.js')

    fc.assert(
      fc.property(oauthConfigArb, (config) => {
        const prodService = new prodModule.OAuthService(config)
        const refService = new refModule.OAuth2ReferenceService(config)

        for (const method of requiredMethods) {
          expect(prodService[method].length).toBe(refService[method].length)
        }
      }),
      { numRuns: 20 }
    )
  })

  it('scopes configuration is preserved in both implementations', async () => {
    const prodModule = await import('#lib/oauth2/service.js')
    const refModule = await import('#lib/oauth2-ref/index.js')

    fc.assert(
      fc.property(oauthConfigArb, (config) => {
        const prodService = new prodModule.OAuthService(config)
        const refService = new refModule.OAuth2ReferenceService(config)

        expect(prodService.scopes).toBe(config.scopes)
        expect(refService.scopes).toBe(config.scopes)
      }),
      { numRuns: 50 }
    )
  })
})
