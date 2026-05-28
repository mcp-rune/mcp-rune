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
})
