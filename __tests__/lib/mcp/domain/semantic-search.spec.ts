import { SemanticSearch } from '../../../../src/mcp/domain/semantic-search.js'

// Mock embeddings module
vi.mock('#src/services/embeddings.js', () => ({
  embed: vi.fn(),
  embedBatch: vi.fn()
}))

import { embed, embedBatch } from '#src/services/embeddings.js'

describe('lib/mcp/domain/semantic-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should use default threshold and topK', () => {
      const search = new SemanticSearch()
      expect(search.threshold).toBe(0.3)
      expect(search.topK).toBe(10)
    })

    it('should accept custom threshold and topK', () => {
      const search = new SemanticSearch({ threshold: 0.5, topK: 5 })
      expect(search.threshold).toBe(0.5)
      expect(search.topK).toBe(5)
    })
  })

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      const search = new SemanticSearch()
      expect(search.isInitialized).toBe(false)
    })

    it('should return true after initialization', async () => {
      const search = new SemanticSearch()
      embedBatch.mockResolvedValue([new Float32Array([1, 0, 0])])

      await search.initialize([{ name: 'item' }], (i) => i.name)
      expect(search.isInitialized).toBe(true)
    })

    it('should return true for empty items', async () => {
      const search = new SemanticSearch()
      await search.initialize([], (i) => i.name)
      expect(search.isInitialized).toBe(true)
    })
  })

  describe('initialize', () => {
    it('should call embedBatch with text representations', async () => {
      const items = [
        { name: 'alpha', desc: 'First item' },
        { name: 'beta', desc: 'Second item' }
      ]
      const textFn = (i) => `${i.name}: ${i.desc}`
      embedBatch.mockResolvedValue([new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])])

      const search = new SemanticSearch()
      await search.initialize(items, textFn)

      expect(embedBatch).toHaveBeenCalledWith(['alpha: First item', 'beta: Second item'])
    })

    it('should skip embedBatch for empty items', async () => {
      const search = new SemanticSearch()
      await search.initialize([], (i) => i.name)

      expect(embedBatch).not.toHaveBeenCalled()
    })
  })

  describe('search', () => {
    it('should return empty array when not initialized', async () => {
      const search = new SemanticSearch()
      const results = await search.search('anything')
      expect(results).toEqual([])
      expect(embed).not.toHaveBeenCalled()
    })

    it('should return empty array for empty items', async () => {
      const search = new SemanticSearch()
      await search.initialize([], (i) => i.name)

      embed.mockResolvedValue(new Float32Array([1, 0, 0]))
      const results = await search.search('anything')
      expect(results).toEqual([])
    })

    it('should rank results by cosine similarity (descending)', async () => {
      const items = [{ name: 'far' }, { name: 'close' }, { name: 'closest' }]
      // Pre-computed embeddings: unit vectors at various angles
      embedBatch.mockResolvedValue([
        new Float32Array([0, 1, 0]), // far: orthogonal to query
        new Float32Array([0.8, 0.6, 0]), // close: high similarity
        new Float32Array([0.95, 0.31, 0]) // closest: highest similarity
      ])

      const search = new SemanticSearch({ threshold: 0.1 })
      await search.initialize(items, (i) => i.name)

      // Query embedding: aligned with [1, 0, 0]
      embed.mockResolvedValue(new Float32Array([1, 0, 0]))
      const results = await search.search('query')

      expect(results).toHaveLength(2) // far (0.0) filtered by threshold=0.1
      expect(results[0].item.name).toBe('closest')
      expect(results[1].item.name).toBe('close')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })

    it('should filter by threshold', async () => {
      const items = [{ name: 'relevant' }, { name: 'irrelevant' }]
      embedBatch.mockResolvedValue([
        new Float32Array([1, 0, 0]), // identical to query
        new Float32Array([0, 1, 0]) // orthogonal to query
      ])

      const search = new SemanticSearch({ threshold: 0.5 })
      await search.initialize(items, (i) => i.name)

      embed.mockResolvedValue(new Float32Array([1, 0, 0]))
      const results = await search.search('query')

      expect(results).toHaveLength(1)
      expect(results[0].item.name).toBe('relevant')
      expect(results[0].score).toBeCloseTo(1.0)
    })

    it('should respect topK limit', async () => {
      const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
      embedBatch.mockResolvedValue([
        new Float32Array([1, 0, 0]),
        new Float32Array([0.9, 0.44, 0]),
        new Float32Array([0.8, 0.6, 0])
      ])

      const search = new SemanticSearch({ threshold: 0.1, topK: 2 })
      await search.initialize(items, (i) => i.name)

      embed.mockResolvedValue(new Float32Array([1, 0, 0]))
      const results = await search.search('query')

      expect(results).toHaveLength(2)
    })

    it('should allow per-search threshold override', async () => {
      const items = [{ name: 'close' }, { name: 'medium' }]
      embedBatch.mockResolvedValue([
        new Float32Array([1, 0, 0]), // score = 1.0 with query
        new Float32Array([0.6, 0.8, 0]) // score ≈ 0.6 with query
      ])

      const search = new SemanticSearch({ threshold: 0.3 })
      await search.initialize(items, (i) => i.name)

      embed.mockResolvedValue(new Float32Array([1, 0, 0]))

      // Default threshold 0.3: both pass
      const resultsDefault = await search.search('query')
      expect(resultsDefault).toHaveLength(2)

      // Override threshold 0.9: only close passes
      const resultsStrict = await search.search('query', { threshold: 0.9 })
      expect(resultsStrict).toHaveLength(1)
      expect(resultsStrict[0].item.name).toBe('close')
    })

    it('should allow per-search topK override', async () => {
      const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
      embedBatch.mockResolvedValue([
        new Float32Array([1, 0, 0]),
        new Float32Array([0.9, 0.44, 0]),
        new Float32Array([0.8, 0.6, 0])
      ])

      const search = new SemanticSearch({ threshold: 0.1, topK: 10 })
      await search.initialize(items, (i) => i.name)

      embed.mockResolvedValue(new Float32Array([1, 0, 0]))

      const results = await search.search('query', { topK: 1 })
      expect(results).toHaveLength(1)
    })
  })
})
