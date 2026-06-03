import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryDataLayer, loadFixturesFromJson } from '../../../src/core/data-layer-stub.js'
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

  describe('dispatch', () => {
    it('GET on a known endpoint returns the JSON:API list envelope analysis_ingest expects', async () => {
      const fixtures: Record<string, Record<string, Record<string, unknown>>> = { book: {} }
      for (let i = 1; i <= 7; i++) {
        fixtures.book![String(i)] = { id: String(i), title: `T${i}` }
      }
      const layer = new InMemoryDataLayer({ models: makeModels(), fixtures })

      const result = await layer.dispatch('GET', 'books', undefined, { page: 2, per_page: 3 })

      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data as unknown[]).toHaveLength(3)
      expect(result.meta).toMatchObject({ page: 2, per_page: 3, total: 7 })
    })

    it('GET on an unknown endpoint returns {}', async () => {
      const layer = new InMemoryDataLayer({ models: makeModels() })
      const result = await layer.dispatch('GET', 'unknown-endpoint')
      expect(result).toEqual({})
    })

    it('non-GET methods return {} (writes belong to typed CRUD)', async () => {
      const layer = new InMemoryDataLayer({ models: makeModels() })
      const post = await layer.dispatch('POST', 'books', { title: 'A' })
      const patch = await layer.dispatch('PATCH', 'books/1', { title: 'B' })
      expect(post).toEqual({})
      expect(patch).toEqual({})
    })
  })

  describe('loadFixturesFromJson', () => {
    let tmp: string

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'mcp-rune-fixtures-'))
    })
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true })
    })

    function writeJson(name: string, value: unknown): string {
      const path = join(tmp, name)
      writeFileSync(path, JSON.stringify(value), 'utf8')
      return path
    }

    it('reads the object-keyed shape verbatim', () => {
      const path = writeJson('books.json', {
        book: {
          '1': { id: '1', title: 'A' },
          '2': { id: '2', title: 'B' }
        }
      })

      const fixtures = loadFixturesFromJson(path)
      expect(Object.keys(fixtures.book!)).toEqual(['1', '2'])
      expect(fixtures.book!['1']).toEqual({ id: '1', title: 'A' })
    })

    it('auto-keys array-shaped models by record.id', () => {
      const path = writeJson('books.json', {
        book: [
          { id: 7, title: 'A' },
          { id: 'k-2', title: 'B' }
        ]
      })

      const fixtures = loadFixturesFromJson(path)
      expect(Object.keys(fixtures.book!).sort()).toEqual(['7', 'k-2'])
      expect(fixtures.book!['7']).toEqual({ id: 7, title: 'A' })
    })

    it('throws a clear error when an array entry is missing `id`', () => {
      const path = writeJson('books.json', {
        book: [{ id: 1, title: 'A' }, { title: 'B' }]
      })
      expect(() => loadFixturesFromJson(path)).toThrow(/missing required `id`/)
    })

    it('throws when the file is missing', () => {
      expect(() => loadFixturesFromJson(join(tmp, 'no-such-file.json'))).toThrow(/cannot read/)
    })

    it('throws when the top level is not an object', () => {
      const path = writeJson('arr.json', [{ id: 1 }])
      expect(() => loadFixturesFromJson(path)).toThrow(/top-level object keyed by model/)
    })
  })
})
