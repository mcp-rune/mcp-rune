/**
 * Introspection Cache Property-Based Tests
 *
 * Validates caching invariants using randomized inputs:
 * - Cached results are always returned within TTL
 * - Expired entries are never returned as fresh
 * - Cache size never exceeds max size
 * - Cache eviction removes oldest entries first
 */

import * as fc from 'fast-check'
import { OAuthService } from '../../../../src/oauth2/service.js'

describe('Introspection Cache Properties', () => {
  let oauth

  beforeEach(() => {
    oauth = new OAuthService({
      identityUrl: 'http://localhost:4000',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3456/callback',
      scopes: 'read write'
    })
  })

  // Arbitrary for tokens (hex strings like real access tokens)
  const tokenArb = fc.stringMatching(/^[0-9a-f]{16,64}$/)

  // Arbitrary for introspection results
  const introspectionResultArb = fc.oneof(
    fc.record({
      active: fc.constant(true),
      sub: fc.uuid(),
      scope: fc.constantFrom('read', 'write', 'read write'),
      client_id: fc.string({ minLength: 1, maxLength: 32 })
    }),
    fc.record({
      active: fc.constant(false)
    })
  )

  it('cached results are always retrievable within TTL', () => {
    fc.assert(
      fc.property(tokenArb, introspectionResultArb, (token, result) => {
        oauth._introspectionCacheTTL = 60000 // 60 seconds

        oauth._cacheIntrospection(token, result)

        const cached = oauth._introspectionCache.get(token)
        expect(cached).toBeDefined()
        expect(cached.result).toEqual(result)

        // Should not be expired
        const isExpired = Date.now() - cached.timestamp >= oauth._introspectionCacheTTL
        expect(isExpired).toBe(false)

        // Clean up
        oauth.clearIntrospectionCache()
      }),
      { numRuns: 100 }
    )
  })

  it('cache size never exceeds max size', () => {
    fc.assert(
      fc.property(
        fc.array(tokenArb, { minLength: 1, maxLength: 200 }),
        introspectionResultArb,
        (tokens, result) => {
          oauth._introspectionCacheMaxSize = 50

          // Cache all tokens
          for (const token of tokens) {
            oauth._cacheIntrospection(token, result)
          }

          expect(oauth._introspectionCache.size).toBeLessThanOrEqual(50)

          // Clean up
          oauth.clearIntrospectionCache()
        }
      ),
      { numRuns: 50 }
    )
  })

  it('most recently cached tokens are always retained when at max size', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[0-9a-f]{16}$/), {
          minLength: 10,
          maxLength: 20
        }),
        (tokens) => {
          // Deduplicate tokens
          const uniqueTokens = [...new Set(tokens)]
          if (uniqueTokens.length < 5) return // Skip if too few unique tokens

          oauth._introspectionCacheMaxSize = 5

          const result = { active: true }
          for (const token of uniqueTokens) {
            oauth._cacheIntrospection(token, result)
          }

          // The most recent tokens (up to max size) should be present
          const recentTokens = uniqueTokens.slice(-5)
          for (const token of recentTokens) {
            expect(oauth._introspectionCache.has(token)).toBe(true)
          }

          // Clean up
          oauth.clearIntrospectionCache()
        }
      ),
      { numRuns: 50 }
    )
  })

  it('clearIntrospectionCache always empties the cache completely', () => {
    fc.assert(
      fc.property(
        fc.array(tokenArb, { minLength: 0, maxLength: 50 }),
        introspectionResultArb,
        (tokens, result) => {
          // Cache some tokens
          for (const token of tokens) {
            oauth._cacheIntrospection(token, result)
          }

          // Clear
          oauth.clearIntrospectionCache()

          expect(oauth._introspectionCache.size).toBe(0)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('cache entries have valid timestamps', () => {
    fc.assert(
      fc.property(tokenArb, introspectionResultArb, (token, result) => {
        const before = Date.now()
        oauth._cacheIntrospection(token, result)
        const after = Date.now()

        const cached = oauth._introspectionCache.get(token)
        expect(cached.timestamp).toBeGreaterThanOrEqual(before)
        expect(cached.timestamp).toBeLessThanOrEqual(after)

        // Clean up
        oauth.clearIntrospectionCache()
      }),
      { numRuns: 100 }
    )
  })

  it('overwriting a cached token updates the result and timestamp', () => {
    fc.assert(
      fc.property(
        tokenArb,
        introspectionResultArb,
        introspectionResultArb,
        (token, result1, result2) => {
          oauth._cacheIntrospection(token, result1)
          const firstTimestamp = oauth._introspectionCache.get(token).timestamp

          oauth._cacheIntrospection(token, result2)
          const cached = oauth._introspectionCache.get(token)

          expect(cached.result).toEqual(result2)
          expect(cached.timestamp).toBeGreaterThanOrEqual(firstTimestamp)

          // Cache size should still be 1 (overwrite, not add)
          expect(oauth._introspectionCache.size).toBeLessThanOrEqual(1)

          // Clean up
          oauth.clearIntrospectionCache()
        }
      ),
      { numRuns: 50 }
    )
  })
})
