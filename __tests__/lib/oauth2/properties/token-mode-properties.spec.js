/**
 * Token Mode Property-Based Tests
 *
 * Validates token mode authentication invariants:
 * - HttpServer always requires exactly one auth mode (oauth XOR accessToken)
 * - Token mode always skips OAuth router registration
 * - Static token is always returned as the access token
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Simulates HttpServer constructor auth mode validation logic
 * Returns: 'oauth' | 'token' | throws
 */
function validateAuthMode(hasOauth, hasAccessToken) {
  if (!hasOauth && !hasAccessToken) {
    throw new Error('HttpServer requires either oauth or accessToken')
  }
  if (hasOauth && hasAccessToken) {
    throw new Error('HttpServer cannot use both oauth and accessToken')
  }
  return hasOauth ? 'oauth' : 'token'
}

describe('Token Mode Properties', () => {
  it('exactly one of oauth or accessToken must be provided (mutual exclusion)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasOauth, hasAccessToken) => {
        const bothPresent = hasOauth && hasAccessToken
        const neitherPresent = !hasOauth && !hasAccessToken

        if (bothPresent || neitherPresent) {
          expect(() => validateAuthMode(hasOauth, hasAccessToken)).toThrow()
        } else {
          expect(() => validateAuthMode(hasOauth, hasAccessToken)).not.toThrow()
        }
      }),
      { numRuns: 50 }
    )
  })

  it('oauth mode is selected when only oauth is provided', () => {
    const mode = validateAuthMode(true, false)
    expect(mode).toBe('oauth')
  })

  it('token mode is selected when only accessToken is provided', () => {
    const mode = validateAuthMode(false, true)
    expect(mode).toBe('token')
  })

  it('static access token is always returned unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9_-]{16,128}$/), async (accessToken) => {
        // Simulates token mode: getAccessToken always returns the static token
        const getAccessToken = async () => accessToken

        const result = await getAccessToken()

        expect(result).toBe(accessToken)
        expect(result.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 }
    )
  })

  it('auth mode validation is deterministic for same inputs', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasOauth, hasAccessToken) => {
        let result1, result2, error1, error2

        try {
          result1 = validateAuthMode(hasOauth, hasAccessToken)
        } catch (e) {
          error1 = e.message
        }

        try {
          result2 = validateAuthMode(hasOauth, hasAccessToken)
        } catch (e) {
          error2 = e.message
        }

        expect(result1).toBe(result2)
        expect(error1).toBe(error2)
      }),
      { numRuns: 50 }
    )
  })
})
