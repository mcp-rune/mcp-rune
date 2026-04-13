/**
 * Token Store Tests
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  storeTokens,
  getTokens,
  getTokensBySession,
  deleteTokens,
  deleteExpiredTokens,
  close,
  _setAdapter
} from '../../../lib/oauth2/token-store.js'

describe('Token Store', () => {
  let mockAdapter

  beforeEach(() => {
    mockAdapter = {
      init: vi.fn(),
      storeTokens: vi.fn(),
      getTokens: vi.fn().mockResolvedValue(null),
      getTokensBySession: vi.fn().mockResolvedValue(null),
      deleteTokens: vi.fn(),
      deleteExpiredTokens: vi.fn().mockResolvedValue(0),
      close: vi.fn()
    }
    _setAdapter(mockAdapter)
  })

  afterEach(() => {
    _setAdapter(null)
  })

  describe('storeTokens()', () => {
    it('should delegate to adapter', async () => {
      const params = {
        userId: 'u1',
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 3600,
        scope: 'read',
        mcpSessionId: 's1'
      }
      await storeTokens(params)
      expect(mockAdapter.storeTokens).toHaveBeenCalledWith(params)
    })
  })

  describe('getTokens()', () => {
    it('should delegate to adapter', async () => {
      const expected = { userId: 'u1', accessToken: 'at' }
      mockAdapter.getTokens.mockResolvedValue(expected)

      const result = await getTokens('u1')
      expect(mockAdapter.getTokens).toHaveBeenCalledWith('u1')
      expect(result).toEqual(expected)
    })
  })

  describe('getTokensBySession()', () => {
    it('should delegate to adapter', async () => {
      const expected = { userId: 'u1', mcpSessionId: 's1' }
      mockAdapter.getTokensBySession.mockResolvedValue(expected)

      const result = await getTokensBySession('s1')
      expect(mockAdapter.getTokensBySession).toHaveBeenCalledWith('s1')
      expect(result).toEqual(expected)
    })
  })

  describe('deleteTokens()', () => {
    it('should delegate to adapter', async () => {
      await deleteTokens('u1')
      expect(mockAdapter.deleteTokens).toHaveBeenCalledWith('u1')
    })
  })

  describe('deleteExpiredTokens()', () => {
    it('should delegate to adapter', async () => {
      mockAdapter.deleteExpiredTokens.mockResolvedValue(3)
      const result = await deleteExpiredTokens()
      expect(result).toBe(3)
    })
  })

  describe('close()', () => {
    it('should delegate to adapter and clear it', async () => {
      await close()
      expect(mockAdapter.close).toHaveBeenCalled()
    })

    it('should be safe when no adapter is set', async () => {
      _setAdapter(null)
      await close() // should not throw
    })
  })

  describe('_setAdapter()', () => {
    it('should replace the adapter', async () => {
      const newAdapter = {
        getTokens: vi.fn().mockResolvedValue({ userId: 'new' })
      }
      _setAdapter(newAdapter)

      const result = await getTokens('x')
      expect(newAdapter.getTokens).toHaveBeenCalledWith('x')
      expect(result).toEqual({ userId: 'new' })
    })
  })

  describe('no adapter configured', () => {
    it('should throw when no adapter is injected', async () => {
      _setAdapter(null)

      await expect(getTokens('x')).rejects.toThrow('Token store not configured')
    })
  })
})
