import {
  SubstringSearch,
  EmbeddingSearch,
  createDomainSearch
} from '../../../../src/mcp/domain/search-strategy.js'

// Mock embeddings module (used by SemanticSearch inside EmbeddingSearch)
vi.mock('#src/services/embeddings.js', () => ({
  embed: vi.fn(),
  embedBatch: vi.fn()
}))

import { embed, embedBatch } from '#src/services/embeddings.js'

const testItems = [
  {
    name: 'deal_rights',
    title: 'Deal Rights Hierarchy',
    description: 'How deals relate to rights.',
    tags: ['licensing', 'hierarchy']
  },
  {
    name: 'content_scheduling',
    title: 'Content Scheduling',
    description: 'Schedule content for broadcast.',
    tags: ['scheduling', 'broadcast']
  },
  {
    name: 'catchup_vod',
    title: 'Catch-up VOD',
    description: 'On-demand availability after broadcast.',
    tags: ['vod', 'catchup']
  }
]

describe('lib/mcp/domain/search-strategy', () => {
  describe('SubstringSearch', () => {
    let search

    beforeEach(async () => {
      search = new SubstringSearch()
      await search.initialize(testItems)
    })

    it('should match by name', async () => {
      const results = await search.search('deal')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('deal_rights')
    })

    it('should match by title', async () => {
      const results = await search.search('Scheduling')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('content_scheduling')
    })

    it('should match by description', async () => {
      const results = await search.search('broadcast')
      expect(results).toHaveLength(2)
    })

    it('should match by tags', async () => {
      const results = await search.search('vod')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('catchup_vod')
    })

    it('should be case-insensitive', async () => {
      const results = await search.search('HIERARCHY')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('deal_rights')
    })

    it('should return empty for no match', async () => {
      const results = await search.search('xyz_nonexistent')
      expect(results).toHaveLength(0)
    })

    it('should work with empty items', async () => {
      const empty = new SubstringSearch()
      await empty.initialize([])
      expect(await empty.search('anything')).toHaveLength(0)
    })

    it('should handle items with missing optional fields', async () => {
      const sparse = new SubstringSearch()
      await sparse.initialize([{ name: 'minimal' }])
      const results = await sparse.search('minimal')
      expect(results).toHaveLength(1)
    })

    it('should ignore textFn parameter', async () => {
      const s = new SubstringSearch()
      const textFn = vi.fn()
      await s.initialize(testItems, textFn)
      expect(textFn).not.toHaveBeenCalled()
    })
  })

  describe('EmbeddingSearch', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should use embedding similarity when initialized', async () => {
      embedBatch.mockResolvedValue([
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 1, 0]),
        new Float32Array([0.9, 0.44, 0])
      ])
      embed.mockResolvedValue(new Float32Array([1, 0, 0]))

      const search = new EmbeddingSearch({ threshold: 0.1 })
      await search.initialize(testItems, (i) => `${i.name}: ${i.description}`)

      const results = await search.search('deal')
      // Items with cosine > 0.1 to [1,0,0]: item 0 (1.0) and item 2 (~0.9)
      expect(results).toHaveLength(2)
      expect(results[0].name).toBe('deal_rights')
    })

    it('should fall back to substring when no embedding results match', async () => {
      embedBatch.mockResolvedValue([
        new Float32Array([0, 1, 0]),
        new Float32Array([0, 0, 1]),
        new Float32Array([0, 0.7, 0.7])
      ])
      // Query orthogonal to all items — no cosine match above threshold
      embed.mockResolvedValue(new Float32Array([1, 0, 0]))

      const search = new EmbeddingSearch({ threshold: 0.5 })
      await search.initialize(testItems, (i) => i.name)

      // No embedding results, but 'deal' appears in item name → substring fallback
      const results = await search.search('deal')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('deal_rights')
    })

    it('should pass options through to SemanticSearch', async () => {
      embedBatch.mockResolvedValue([
        new Float32Array([1, 0, 0]),
        new Float32Array([0.9, 0.44, 0]),
        new Float32Array([0.8, 0.6, 0])
      ])
      embed.mockResolvedValue(new Float32Array([1, 0, 0]))

      const search = new EmbeddingSearch({ threshold: 0.1, topK: 1 })
      await search.initialize(testItems, (i) => i.name)

      const results = await search.search('query')
      expect(results).toHaveLength(1)
    })
  })

  describe('createDomainSearch', () => {
    it('should return SubstringSearch by default', () => {
      const search = createDomainSearch()
      expect(search).toBeInstanceOf(SubstringSearch)
    })

    it('should return SubstringSearch for "substring"', () => {
      const search = createDomainSearch('substring')
      expect(search).toBeInstanceOf(SubstringSearch)
    })

    it('should return EmbeddingSearch for "embedding"', () => {
      const search = createDomainSearch('embedding')
      expect(search).toBeInstanceOf(EmbeddingSearch)
    })

    it('should pass options to EmbeddingSearch', () => {
      const search = createDomainSearch('embedding', { threshold: 0.5, topK: 5 })
      expect(search).toBeInstanceOf(EmbeddingSearch)
    })

    it('should default to SubstringSearch for unknown strategy', () => {
      const search = createDomainSearch('unknown')
      expect(search).toBeInstanceOf(SubstringSearch)
    })
  })
})
