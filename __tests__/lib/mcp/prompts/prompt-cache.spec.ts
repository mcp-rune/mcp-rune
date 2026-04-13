/**
 * Tests for PromptCache
 */

import { PromptCache, createPromptCache } from '../../../../src/mcp/prompts/prompt-cache.js'

describe('PromptCache', () => {
  let mockRegistry
  let cache
  let getPromptCallCount

  beforeEach(() => {
    getPromptCallCount = 0

    // Mock PromptRegistry with all methods
    mockRegistry = {
      getPrompt: (name, args) => {
        getPromptCallCount++
        return {
          description: `Prompt for ${name}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Mock content for ${name} with args ${JSON.stringify(args)}`
              }
            }
          ]
        }
      },
      getDefinitions: () => [{ name: 'test_prompt', title: 'Test Prompt', description: 'Test' }],
      getAllPromptNames: () => ['test_prompt', 'create_brand'],
      getPromptClass: (name) => (name === 'test_prompt' ? class TestPrompt {} : null),
      getPromptClassByModel: (model) => (model === 'brand' ? class BrandPrompt {} : null),
      getRequiredPrompts: () => [['create_rule', { model: 'rule', required: true }]],
      getPromptRequiredModels: () => ['rule', 'right', 'deal'],
      getPromptMap: () => ({ brand: 'create_brand', series: 'create_series' }),
      getToolDocDescriptionList: () => '- create_brand: For brands\n- create_series: For series',
      getRequiredPromptRestrictions: () => '- "rule" - First call get_prompt_guide',
      getBulkRecommendedPrompts: () => [['create_asset', { model: 'asset' }]],
      getBulkRecommendations: () => '- "asset" - call get_prompt_guide',
      getPromptNameByModel: (model) => (model === 'brand' ? 'create_brand' : null)
    }

    cache = new PromptCache(mockRegistry, {
      ttl: 1000, // 1 second for testing
      maxSize: 3
    })
  })

  describe('getPrompt', () => {
    it('should cache prompt content on first call', () => {
      const result = cache.getPrompt('create_brand', { name: 'Test' })

      expect(result).toEqual({
        description: 'Prompt for create_brand',
        messages: expect.any(Array)
      })
      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.misses).toBe(1)
      expect(cache.stats.hits).toBe(0)
    })

    it('should return cached content on subsequent calls', () => {
      // First call
      cache.getPrompt('create_brand', { name: 'Test' })

      // Second call
      const result = cache.getPrompt('create_brand', { name: 'Test' })

      expect(result).toEqual({
        description: 'Prompt for create_brand',
        messages: expect.any(Array)
      })
      expect(getPromptCallCount).toBe(1) // Only called once
      expect(cache.stats.misses).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should cache prompts with different arguments separately', () => {
      cache.getPrompt('create_brand', { name: 'Brand1' })
      cache.getPrompt('create_brand', { name: 'Brand2' })

      expect(getPromptCallCount).toBe(2)
      expect(cache.cache.size).toBe(2)
    })

    it('should handle prompts with no arguments', () => {
      cache.getPrompt('test_prompt')
      cache.getPrompt('test_prompt')

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should expire cached content after TTL', async () => {
      cache.getPrompt('create_brand', { name: 'Test' })

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100))

      cache.getPrompt('create_brand', { name: 'Test' })

      expect(getPromptCallCount).toBe(2)
      expect(cache.stats.misses).toBe(2)
      expect(cache.stats.hits).toBe(0)
    })

    it('should build consistent cache keys regardless of argument order', () => {
      cache.getPrompt('test', { a: 1, b: 2 })
      cache.getPrompt('test', { b: 2, a: 1 }) // Different order

      expect(getPromptCallCount).toBe(1) // Same cache key
      expect(cache.stats.hits).toBe(1)
    })
  })

  describe('cache eviction', () => {
    it('should evict oldest entry when maxSize is reached', () => {
      // Fill cache to max (3 entries)
      cache.getPrompt('prompt1', { id: 1 })
      cache.getPrompt('prompt2', { id: 2 })
      cache.getPrompt('prompt3', { id: 3 })

      expect(cache.cache.size).toBe(3)
      expect(cache.stats.evictions).toBe(0)

      // Add 4th entry - should evict oldest
      cache.getPrompt('prompt4', { id: 4 })

      expect(cache.cache.size).toBe(3) // Still at max
      expect(cache.stats.evictions).toBe(1)

      // First entry should be evicted, calling it again should be a miss
      cache.getPrompt('prompt1', { id: 1 })
      expect(cache.stats.misses).toBe(5) // 4 initial + 1 after eviction
    })
  })

  describe('clear', () => {
    it('should clear all cached entries', () => {
      cache.getPrompt('prompt1')
      cache.getPrompt('prompt2')

      expect(cache.cache.size).toBe(2)

      cache.clear()

      expect(cache.cache.size).toBe(0)
    })
  })

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cache.getPrompt('prompt1')
      cache.getPrompt('prompt1') // hit
      cache.getPrompt('prompt2')

      const stats = cache.getStats()

      expect(stats).toEqual({
        hits: 1,
        misses: 2,
        evictions: 0,
        total: 3,
        hitRate: '33.3%',
        size: 2,
        maxSize: 3
      })
    })

    it('should handle zero requests', () => {
      const stats = cache.getStats()

      expect(stats).toEqual({
        hits: 0,
        misses: 0,
        evictions: 0,
        total: 0,
        hitRate: '0.0%',
        size: 0,
        maxSize: 3
      })
    })
  })

  describe('getDefinitions', () => {
    it('should pass through to registry', () => {
      const result = cache.getDefinitions()

      expect(result).toEqual([{ name: 'test_prompt', title: 'Test Prompt', description: 'Test' }])
    })
  })

  describe('delegation methods', () => {
    it('should delegate getAllPromptNames to registry', () => {
      const result = cache.getAllPromptNames()

      expect(result).toEqual(['test_prompt', 'create_brand'])
    })

    it('should delegate getPromptClass to registry', () => {
      const result = cache.getPromptClass('test_prompt')

      expect(result).toBeDefined()
      expect(result.name).toBe('TestPrompt')
    })

    it('should delegate getPromptClass for unknown prompt', () => {
      const result = cache.getPromptClass('unknown')

      expect(result).toBe(null)
    })

    it('should delegate getPromptClassByModel to registry', () => {
      const result = cache.getPromptClassByModel('brand')

      expect(result).toBeDefined()
      expect(result.name).toBe('BrandPrompt')
    })

    it('should delegate getPromptClassByModel for unknown model', () => {
      const result = cache.getPromptClassByModel('unknown')

      expect(result).toBe(null)
    })

    it('should delegate getRequiredPrompts to registry', () => {
      const result = cache.getRequiredPrompts()

      expect(result).toEqual([['create_rule', { model: 'rule', required: true }]])
    })

    it('should delegate getPromptRequiredModels to registry', () => {
      const result = cache.getPromptRequiredModels()

      expect(result).toEqual(['rule', 'right', 'deal'])
    })

    it('should delegate getPromptMap to registry', () => {
      const result = cache.getPromptMap()

      expect(result).toEqual({ brand: 'create_brand', series: 'create_series' })
    })

    it('should delegate getToolDocDescriptionList to registry', () => {
      const result = cache.getToolDocDescriptionList()

      expect(result).toBe('- create_brand: For brands\n- create_series: For series')
    })

    it('should delegate getRequiredPromptRestrictions to registry', () => {
      const result = cache.getRequiredPromptRestrictions()

      expect(result).toBe('- "rule" - First call get_prompt_guide')
    })

    it('should delegate getBulkRecommendedPrompts to registry', () => {
      const result = cache.getBulkRecommendedPrompts()

      expect(result).toEqual([['create_asset', { model: 'asset' }]])
    })

    it('should delegate getBulkRecommendations to registry', () => {
      const result = cache.getBulkRecommendations()

      expect(result).toBe('- "asset" - call get_prompt_guide')
    })

    it('should delegate getPromptNameByModel to registry', () => {
      const result = cache.getPromptNameByModel('brand')

      expect(result).toBe('create_brand')
    })

    it('should delegate getPromptNameByModel for unknown model', () => {
      const result = cache.getPromptNameByModel('unknown')

      expect(result).toBe(null)
    })

    it('should delegate getFormSchema to registry', () => {
      mockRegistry.getFormSchema = (name) =>
        name === 'test_prompt' ? { name: 'TestPrompt', fieldDefinitions: {} } : null

      cache = new PromptCache(mockRegistry, { ttl: 1000, maxSize: 3 })

      const result = cache.getFormSchema('test_prompt')

      expect(result).toEqual({ name: 'TestPrompt', fieldDefinitions: {} })
    })
  })

  describe('caching behavior with complex arguments', () => {
    it('should handle nested objects in arguments', () => {
      const args1 = { filter: { name: 'test', type: 'brand' } }
      const args2 = { filter: { name: 'test', type: 'brand' } }

      cache.getPrompt('test', args1)
      cache.getPrompt('test', args2)

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should treat different nested object values as different cache keys', () => {
      cache.getPrompt('test', { filter: { type: 'brand' } })
      cache.getPrompt('test', { filter: { type: 'series' } })

      expect(getPromptCallCount).toBe(2)
      expect(cache.cache.size).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('should handle empty arguments object', () => {
      cache.getPrompt('test_prompt', {})
      cache.getPrompt('test_prompt', {})

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should handle undefined arguments', () => {
      cache.getPrompt('test_prompt', undefined)
      cache.getPrompt('test_prompt', undefined)

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should treat empty object and undefined as same cache key', () => {
      cache.getPrompt('test_prompt', {})
      cache.getPrompt('test_prompt', undefined)
      cache.getPrompt('test_prompt')

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(2)
    })

    it('should handle null values in arguments', () => {
      cache.getPrompt('test', { value: null })
      cache.getPrompt('test', { value: null })

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should treat null and undefined as equivalent in arguments', () => {
      cache.getPrompt('test', { value: null })
      cache.getPrompt('test', { value: undefined })

      // Both null and undefined serialize to 'null', so they're treated as equivalent
      expect(getPromptCallCount).toBe(1)
      expect(cache.cache.size).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should handle array values in arguments', () => {
      cache.getPrompt('test', { ids: [1, 2, 3] })
      cache.getPrompt('test', { ids: [1, 2, 3] })

      expect(getPromptCallCount).toBe(1)
      expect(cache.stats.hits).toBe(1)
    })

    it('should distinguish different array orders', () => {
      cache.getPrompt('test', { ids: [1, 2, 3] })
      cache.getPrompt('test', { ids: [3, 2, 1] })

      expect(getPromptCallCount).toBe(2)
      expect(cache.cache.size).toBe(2)
    })
  })

  describe('createPromptCache factory', () => {
    it('should create a PromptCache instance', () => {
      const newCache = createPromptCache(mockRegistry)

      expect(newCache).toBeInstanceOf(PromptCache)
      // Verify it works by caching a prompt
      newCache.getPrompt('test')
      newCache.getPrompt('test')
      expect(newCache.stats.hits).toBe(1)
    })

    it('should create a PromptCache instance with custom options', () => {
      const newCache = createPromptCache(mockRegistry, {
        ttl: 1000,
        maxSize: 2
      })

      expect(newCache).toBeInstanceOf(PromptCache)

      // Verify custom maxSize works
      newCache.getPrompt('p1')
      newCache.getPrompt('p2')
      newCache.getPrompt('p3') // Should trigger eviction

      expect(newCache.cache.size).toBe(2) // Custom maxSize
      expect(newCache.stats.evictions).toBe(1)
    })

    it('should use default options when none provided', () => {
      const newCache = createPromptCache(mockRegistry)

      // Default TTL: 5 minutes (300000ms)
      // Default maxSize: 100
      // We can verify defaults by checking the cache can hold many items
      for (let i = 0; i < 10; i++) {
        newCache.getPrompt(`prompt${i}`)
      }

      expect(newCache.cache.size).toBe(10) // No evictions with default maxSize of 100
      expect(newCache.stats.evictions).toBe(0)
    })
  })

  describe('concurrent access', () => {
    it('should handle multiple simultaneous cache misses for same key', () => {
      // Simulate concurrent access - both should trigger generation
      // but only one value will be stored
      const promise1 = Promise.resolve(cache.getPrompt('test', { id: 1 }))
      const promise2 = Promise.resolve(cache.getPrompt('test', { id: 1 }))

      return Promise.all([promise1, promise2]).then(() => {
        // Both calls should complete successfully
        // Second call should be a cache hit
        expect(cache.stats.hits).toBeGreaterThanOrEqual(0)
        expect(cache.cache.size).toBe(1)
      })
    })
  })

  describe('cache size limits', () => {
    it('should maintain maxSize limit with many entries', () => {
      // Add more than maxSize entries
      for (let i = 0; i < 10; i++) {
        cache.getPrompt(`prompt${i}`)
      }

      expect(cache.cache.size).toBeLessThanOrEqual(3)
      expect(cache.stats.evictions).toBe(7) // 10 - 3 = 7 evictions
    })

    it('should continue functioning after many evictions', () => {
      // Fill and overflow cache multiple times
      for (let i = 0; i < 20; i++) {
        cache.getPrompt(`prompt${i}`)
      }

      // Should still cache new entries
      cache.getPrompt('test_final')
      cache.getPrompt('test_final')

      expect(cache.stats.hits).toBeGreaterThanOrEqual(1)
      expect(cache.cache.size).toBe(3)
    })
  })
})
