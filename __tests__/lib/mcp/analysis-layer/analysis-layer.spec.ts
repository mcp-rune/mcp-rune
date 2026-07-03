import {
  createAnalysisLayerFactory,
  type HopBatch
} from '../../../../src/mcp/analysis-layer/analysis-layer.js'
import type { DataLayer } from '../../../../src/mcp/data-layer/data-layer.js'
import type { ModelsRegistry } from '../../../../src/mcp/models/model-definitions.js'

describe('lib/mcp/analysis-layer/analysis-layer', () => {
  const models = {
    book: {
      associations: {
        belongsTo: {
          author: { target_model: 'author' },
          genre: { target_model: 'genre' }
        }
      }
    },
    author: {
      associations: {
        hasMany: { books: { target_model: 'book', many: true } }
      }
    },
    genre: {}
  } as unknown as ModelsRegistry

  const fixtures: Record<string, Record<string, Record<string, unknown>>> = {
    book: {
      b1: { id: 'b1', title: 'Clean Code', author_id: 'a1', genre_id: 'g1' },
      b2: { id: 'b2', title: 'Refactoring', author_id: 'a1' }
    },
    author: {
      a1: { id: 'a1', name: 'Martin', book_ids: ['b1', 'b2'] }
    },
    genre: {
      g1: { id: 'g1', name: 'Software' }
    }
  }

  function stubDataLayer(findCalls: string[]): DataLayer {
    return {
      find: async (model: string, id: string) => {
        findCalls.push(`${model}:${id}`)
        const record = fixtures[model]?.[id]
        if (!record) throw new Error(`not found: ${model}:${id}`)
        return record
      }
    } as unknown as DataLayer
  }

  async function collect(gen: AsyncGenerator<HopBatch>): Promise<HopBatch[]> {
    const batches: HopBatch[] = []
    for await (const batch of gen) batches.push(batch)
    return batches
  }

  it('throws on unknown model names', () => {
    const factory = createAnalysisLayerFactory(models, stubDataLayer([]))
    expect(() => factory('publisher')).toThrow(/unknown model "publisher"/)
  })

  describe('walkHops', () => {
    it('yields one batch per (model, depth) and follows edges into destination models', async () => {
      const findCalls: string[] = []
      const factory = createAnalysisLayerFactory(models, stubDataLayer(findCalls))
      const batches = await collect(
        factory('book').walkHops([fixtures.book!.b1!], { maxDepth: 2, hopFollow: 'declared' })
      )

      const byModel = Object.fromEntries(batches.map((b) => [b.model, b]))
      expect(byModel.author?.depth).toBe(1)
      expect(byModel.author?.records).toEqual([fixtures.author!.a1])
      expect(byModel.genre?.depth).toBe(1)
      expect(byModel.book?.depth).toBe(2)
      expect(byModel.book?.records).toEqual([fixtures.book!.b2])
    })

    it('is cycle-safe: never refetches a visited record', async () => {
      const findCalls: string[] = []
      const factory = createAnalysisLayerFactory(models, stubDataLayer(findCalls))
      await collect(
        factory('book').walkHops([fixtures.book!.b1!], { maxDepth: 3, hopFollow: 'declared' })
      )
      // b1 is the root: the author's hasMany edge back to it must not refetch it.
      expect(findCalls.filter((c) => c === 'book:b1')).toEqual([])
      expect(new Set(findCalls).size).toBe(findCalls.length)
    })

    it('restricts traversal to whitelisted destination models', async () => {
      const factory = createAnalysisLayerFactory(models, stubDataLayer([]))
      const batches = await collect(
        factory('book').walkHops([fixtures.book!.b1!], {
          maxDepth: 1,
          hopFollow: 'declared',
          modelWhitelist: ['author']
        })
      )
      expect(batches.map((b) => b.model)).toEqual(['author'])
    })

    it('yields nothing at maxDepth 0', async () => {
      const factory = createAnalysisLayerFactory(models, stubDataLayer([]))
      const batches = await collect(
        factory('book').walkHops([fixtures.book!.b1!], { maxDepth: 0, hopFollow: 'declared' })
      )
      expect(batches).toEqual([])
    })
  })
})
