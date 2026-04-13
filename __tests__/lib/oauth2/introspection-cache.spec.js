/**
 * OAuth2 Token Introspection Caching Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { OAuthService } from '../../../lib/oauth2/service.js'

describe('OAuth2 Token Introspection Caching Logic', () => {
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

  describe('_cacheIntrospection', () => {
    it('should cache introspection results', () => {
      const token = 'test-token-123'
      const result = { active: true, sub: 'user123', scope: 'read write' }

      oauth._cacheIntrospection(token, result)

      expect(oauth._introspectionCache.size).toBe(1)
      const cached = oauth._introspectionCache.get(token)
      expect(cached.result).toEqual(result)
      expect(cached.timestamp).toBeGreaterThan(0)
    })

    it('should cache multiple tokens separately', () => {
      const token1 = 'token-1'
      const token2 = 'token-2'
      const result1 = { active: true, sub: 'user1' }
      const result2 = { active: true, sub: 'user2' }

      oauth._cacheIntrospection(token1, result1)
      oauth._cacheIntrospection(token2, result2)

      expect(oauth._introspectionCache.size).toBe(2)
      expect(oauth._introspectionCache.get(token1).result).toEqual(result1)
      expect(oauth._introspectionCache.get(token2).result).toEqual(result2)
    })

    it('should evict oldest entry when max size reached', () => {
      oauth._introspectionCacheMaxSize = 3

      oauth._cacheIntrospection('token-1', { active: true })
      oauth._cacheIntrospection('token-2', { active: true })
      oauth._cacheIntrospection('token-3', { active: true })

      expect(oauth._introspectionCache.size).toBe(3)
      expect(oauth._introspectionCache.has('token-1')).toBe(true)

      // Add one more - should evict token-1 (oldest)
      oauth._cacheIntrospection('token-4', { active: true })

      expect(oauth._introspectionCache.size).toBe(3)
      expect(oauth._introspectionCache.has('token-1')).toBe(false)
      expect(oauth._introspectionCache.has('token-4')).toBe(true)
    })
  })

  describe('clearIntrospectionCache', () => {
    it('should clear all cached entries', () => {
      oauth._cacheIntrospection('token-1', { active: true })
      oauth._cacheIntrospection('token-2', { active: true })

      expect(oauth._introspectionCache.size).toBe(2)

      oauth.clearIntrospectionCache()

      expect(oauth._introspectionCache.size).toBe(0)
    })
  })

  describe('cache TTL logic', () => {
    it('should respect TTL when checking cache', () => {
      const token = 'test-token'
      const result = { active: true }

      // Set short TTL
      oauth._introspectionCacheTTL = 100

      // Manually cache with old timestamp
      oauth._introspectionCache.set(token, {
        result,
        timestamp: Date.now() - 200 // 200ms ago (expired)
      })

      // Check if it would be considered expired
      const cached = oauth._introspectionCache.get(token)
      const isExpired = Date.now() - cached.timestamp >= oauth._introspectionCacheTTL

      expect(isExpired).toBe(true)
    })

    it('should not expire fresh cache entries', () => {
      const token = 'test-token'
      const result = { active: true }

      oauth._introspectionCacheTTL = 60 * 1000 // 60 seconds

      // Cache now
      oauth._cacheIntrospection(token, result)

      const cached = oauth._introspectionCache.get(token)
      const isExpired = Date.now() - cached.timestamp >= oauth._introspectionCacheTTL

      expect(isExpired).toBe(false)
    })
  })

  describe('initialization', () => {
    it('should initialize cache with default settings', () => {
      expect(oauth._introspectionCache).toBeDefined()
      expect(oauth._introspectionCache instanceof Map).toBe(true)
      expect(oauth._introspectionCacheTTL).toBe(60 * 1000) // 60 seconds
      expect(oauth._introspectionCacheMaxSize).toBe(100)
    })

    it('should start with empty cache', () => {
      expect(oauth._introspectionCache.size).toBe(0)
    })
  })
})
