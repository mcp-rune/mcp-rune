import { InMemoryDataLayer } from '../../../src/core/data-layer-stub.js'
import type { ModelConfig } from '../../../src/mcp/tools/base-tool.js'

describe('lib/core/data-layer-stub', () => {
  function makeModels(): Record<string, ModelConfig> {
    return {
      book: {
        attributes: { title: { type: 'string', required: true } },
        required: ['title'],
        api: { endpoint: 'books' }
      }
    }
  }

  describe('listNormalized', () => {
    it('returns fixtures as { records, pagination } without applying a convention', async () => {
      const layer = new InMemoryDataLayer({
        models: makeModels(),
        fixtures: {
          book: {
            '1': { id: '1', title: 'A' },
            '2': { id: '2', title: 'B' }
          }
        }
      })

      const result = await layer.listNormalized('book')

      expect(result.records).toHaveLength(2)
      expect(result.pagination.page).toBe(1)
      expect(result.pagination.total).toBe(2)
    })

    it('honors page + perPage', async () => {
      const fixtures: Record<string, Record<string, Record<string, unknown>>> = { book: {} }
      for (let i = 1; i <= 25; i++) {
        fixtures.book![String(i)] = { id: String(i), title: `T${i}` }
      }
      const layer = new InMemoryDataLayer({ models: makeModels(), fixtures })

      const result = await layer.listNormalized('book', undefined, { page: 2, perPage: 10 })

      expect(result.records).toHaveLength(10)
      expect(result.pagination.page).toBe(2)
      expect(result.pagination.total).toBe(25)
    })

    it('filters by exact-match before paginating', async () => {
      const layer = new InMemoryDataLayer({
        models: makeModels(),
        fixtures: {
          book: {
            '1': { id: '1', title: 'A', status: 'active' },
            '2': { id: '2', title: 'B', status: 'archived' },
            '3': { id: '3', title: 'C', status: 'active' }
          }
        }
      })

      const result = await layer.listNormalized('book', { status: 'active' })

      expect(result.records).toHaveLength(2)
      expect(result.records.map((r) => r.id)).toEqual(['1', '3'])
    })
  })

  describe('searchNormalized', () => {
    it('delegates to listNormalized (ignores query, has no search backend)', async () => {
      const layer = new InMemoryDataLayer({
        models: makeModels(),
        fixtures: {
          book: { '1': { id: '1', title: 'A' }, '2': { id: '2', title: 'B' } }
        }
      })
      const result = await layer.searchNormalized('book', 'whatever')
      expect(result.records).toHaveLength(2)
    })
  })

  describe('lookupNormalized', () => {
    it('returns a small page from the model bucket regardless of query', async () => {
      const layer = new InMemoryDataLayer({
        models: makeModels(),
        fixtures: {
          book: {
            '1': { id: '1', title: 'Alpha' },
            '2': { id: '2', title: 'Beta' },
            '3': { id: '3', title: 'Gamma' }
          }
        }
      })
      const result = await layer.lookupNormalized('book', 'beta', { perPage: 5 })
      expect(result.records).toHaveLength(3)
      expect(result.pagination.per_page).toBe(5)
    })

    it('defaults perPage to 10', async () => {
      const layer = new InMemoryDataLayer({ models: makeModels() })
      const result = await layer.lookupNormalized('book', 'x')
      expect(result.pagination.per_page).toBe(10)
    })
  })

  describe('groupSearchNormalized', () => {
    it('throws a clear error pointing at the search extension', async () => {
      const layer = new InMemoryDataLayer({ models: makeModels() })
      await expect(layer.groupSearchNormalized('any', 'x')).rejects.toThrow(/search ApiExtension/)
    })
  })
})
