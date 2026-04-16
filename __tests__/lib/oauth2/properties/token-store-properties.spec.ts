/**
 * Token Store Property-Based Tests
 *
 * Validates token store invariants using randomized inputs:
 * - Random session IDs with stored tokens are always retrievable
 * - Deleted tokens are never retrievable
 * - Store/retrieve roundtrip preserves token data
 */

import * as fc from 'fast-check'

import {
  _setAdapter,
  deleteTokens,
  getTokens,
  getTokensBySession,
  storeTokens
} from '../../../../src/oauth2/token-store.js'

describe('Token Store Properties', () => {
  let store

  beforeEach(() => {
    // In-memory adapter for property testing
    store = new Map()

    const mockAdapter = {
      init: vi.fn(),
      storeTokens: vi.fn(async (params) => {
        store.set(params.userId, { ...params })
        // Also index by session
        if (params.mcpSessionId) {
          store.set(`session:${params.mcpSessionId}`, { ...params })
        }
      }),
      getTokens: vi.fn(async (userId) => store.get(userId) || null),
      getTokensBySession: vi.fn(async (sessionId) => store.get(`session:${sessionId}`) || null),
      deleteTokens: vi.fn(async (userId) => {
        const entry = store.get(userId)
        store.delete(userId)
        if (entry?.mcpSessionId) {
          store.delete(`session:${entry.mcpSessionId}`)
        }
      }),
      deleteExpiredTokens: vi.fn(async () => 0),
      close: vi.fn()
    }
    _setAdapter(mockAdapter)
  })

  afterEach(() => {
    _setAdapter(null)
    store.clear()
  })

  // Arbitrary for token store parameters
  const tokenParamsArb = fc.record({
    userId: fc.uuid(),
    accessToken: fc.stringMatching(/^[0-9a-f]{32,64}$/),
    refreshToken: fc.stringMatching(/^[0-9a-f]{32,64}$/),
    expiresIn: fc.integer({ min: 60, max: 86400 }),
    scope: fc.constantFrom('read', 'write', 'read write', 'openid read write'),
    mcpSessionId: fc.uuid()
  })

  it('stored tokens are always retrievable by userId', async () => {
    await fc.assert(
      fc.asyncProperty(tokenParamsArb, async (params) => {
        await storeTokens(params)

        const result = await getTokens(params.userId)

        expect(result).not.toBeNull()
        expect(result.userId).toBe(params.userId)
        expect(result.accessToken).toBe(params.accessToken)
        expect(result.refreshToken).toBe(params.refreshToken)

        // Clean up for next iteration
        await deleteTokens(params.userId)
      }),
      { numRuns: 50 }
    )
  })

  it('stored tokens are always retrievable by sessionId', async () => {
    await fc.assert(
      fc.asyncProperty(tokenParamsArb, async (params) => {
        await storeTokens(params)

        const result = await getTokensBySession(params.mcpSessionId)

        expect(result).not.toBeNull()
        expect(result.mcpSessionId).toBe(params.mcpSessionId)
        expect(result.accessToken).toBe(params.accessToken)

        // Clean up
        await deleteTokens(params.userId)
      }),
      { numRuns: 50 }
    )
  })

  it('deleted tokens are never retrievable', async () => {
    await fc.assert(
      fc.asyncProperty(tokenParamsArb, async (params) => {
        await storeTokens(params)
        await deleteTokens(params.userId)

        const byUser = await getTokens(params.userId)
        const bySession = await getTokensBySession(params.mcpSessionId)

        expect(byUser).toBeNull()
        expect(bySession).toBeNull()
      }),
      { numRuns: 50 }
    )
  })

  it('storing tokens for same userId overwrites previous', async () => {
    await fc.assert(
      fc.asyncProperty(tokenParamsArb, tokenParamsArb, async (params1, params2) => {
        // Use same userId but different tokens
        const sameUserParams = { ...params2, userId: params1.userId }

        await storeTokens(params1)
        await storeTokens(sameUserParams)

        const result = await getTokens(params1.userId)

        expect(result).not.toBeNull()
        expect(result.accessToken).toBe(sameUserParams.accessToken)

        // Clean up
        await deleteTokens(params1.userId)
      }),
      { numRuns: 50 }
    )
  })

  it('non-existent userId always returns null', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        const result = await getTokens(userId)
        expect(result).toBeNull()
      }),
      { numRuns: 50 }
    )
  })

  it('non-existent sessionId always returns null', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (sessionId) => {
        const result = await getTokensBySession(sessionId)
        expect(result).toBeNull()
      }),
      { numRuns: 50 }
    )
  })
})
