import { describe, expect, it } from 'vitest'

import {
  getLookupableModelNames,
  getModelFilters,
  getQueryableModelNames,
  getSearchableModelNames,
  getSearchConfig
} from '../../../../src/api-extensions/search/capabilities.js'
import type { ModelConfig } from '../../../../src/mcp/tools/base-tool.js'

const withSearch = (search: ModelConfig['search']): ModelConfig =>
  ({ api: { endpoint: 'm' }, search }) as ModelConfig

describe('api-extensions/search/capabilities', () => {
  describe('getSearchConfig', () => {
    it('returns the search object when present', () => {
      const cfg = withSearch({ filters: { name: { type: 'text' } } })
      expect(getSearchConfig(cfg)?.filters).toEqual({ name: { type: 'text' } })
    })

    it('returns undefined for a model with no search declaration', () => {
      expect(getSearchConfig({ api: { endpoint: 'm' } } as ModelConfig)).toBeUndefined()
    })

    it('returns undefined when search is null (legacy default)', () => {
      expect(getSearchConfig(withSearch(null))).toBeUndefined()
    })
  })

  describe('getModelFilters', () => {
    it('returns the filters map when declared', () => {
      const cfg = withSearch({ filters: { status: { type: 'enum' } } })
      expect(getModelFilters(cfg)).toEqual({ status: { type: 'enum' } })
    })

    it('returns undefined when no filters declared', () => {
      expect(getModelFilters(withSearch({ lookup: { fields: ['n'] } }))).toBeUndefined()
    })
  })

  describe('getSearchableModelNames', () => {
    it('lists models that declare at least one filter', () => {
      const models = {
        book: withSearch({ filters: { status: { type: 'enum' } } }),
        review: withSearch({ lookup: { fields: ['author'] } }),
        page: { api: { endpoint: 'pages' } } as ModelConfig
      }
      expect(getSearchableModelNames(models).sort()).toEqual(['book'])
    })

    it('returns an empty array when no model is searchable', () => {
      expect(getSearchableModelNames({})).toEqual([])
    })
  })

  describe('getLookupableModelNames', () => {
    it('lists models that declare at least one lookup field', () => {
      const models = {
        book: withSearch({ lookup: { fields: ['title'] } }),
        review: withSearch({ filters: { rating: { type: 'enum' } } }),
        empty: withSearch({ lookup: { fields: [] } })
      }
      expect(getLookupableModelNames(models).sort()).toEqual(['book'])
    })
  })

  describe('getQueryableModelNames', () => {
    it('lists models that declare a query endpoint or group', () => {
      const models = {
        title: withSearch({ query: { endpoint: 'titles/search' } }),
        review: withSearch({ filters: { rating: { type: 'enum' } } }),
        scheduling: withSearch({ query: { group: 'catalogue' } })
      }
      expect(getQueryableModelNames(models).sort()).toEqual(['scheduling', 'title'])
    })
  })
})
