import { SearchEnabledDataLayer } from '../../../../src/api-extensions/search/search-enabled-data-layer.js'

class FakeModel {
  static api = { endpoint: 'books' }
  static singularName = 'book'
  static extensions = { search: { lookup: { fields: ['title'] } } }
}

class FakeQueryableModel {
  static api = { endpoint: 'activities' }
  static singularName = 'activity'
  static extensions = {
    search: {
      lookup: { fields: ['title'] },
      query: { endpoint: 'activities/search', method: 'POST' }
    }
  }
}

class FakeNestedModel {
  static api = { endpoint: 'assets', standalone: false }
  static singularName = 'asset'
  static extensions = { search: { lookup: { fields: ['name'] } } }
}

function makeBase(models) {
  return {
    models,
    endpointResolver: {},
    calls: { list: 0, listNormalized: 0, searchNormalized: 0, lookupNormalized: 0 },
    async list() {
      this.calls.list++
      return {}
    },
    async listNormalized() {
      this.calls.listNormalized++
      return { records: [{ id: 'L1' }], pagination: { page: 1, per_page: 20, total: 1 } }
    },
    async searchNormalized() {
      this.calls.searchNormalized++
      return { records: [], pagination: { page: 1, per_page: 20, total: 0 } }
    },
    async lookupNormalized() {
      this.calls.lookupNormalized++
      return { records: [], pagination: { page: 1, per_page: 10, total: 0 } }
    },
    async groupSearchNormalized() {
      throw new Error('base should not be called')
    },
    async create() {
      return {}
    },
    async find() {
      return {}
    },
    async update() {
      return {}
    },
    async delete() {
      return {}
    },
    async dispatch() {
      return {}
    },
    buildPayload() {
      return {}
    }
  }
}

function makeSearch() {
  return {
    calls: { search: 0, lookup: 0, groupSearch: 0 },
    lastArgs: null,
    async search(_MC, query, opts) {
      this.calls.search++
      this.lastArgs = { fn: 'search', query, opts }
      return {
        records: [{ id: 'S1', title: 'searched' }],
        pagination: { page: opts?.page ?? 1, per_page: opts?.perPage ?? 20, total: 1 }
      }
    },
    async lookup(_MC, query, opts) {
      this.calls.lookup++
      this.lastArgs = { fn: 'lookup', query, opts }
      return {
        records: [{ id: 'L1', title: 'looked-up' }],
        pagination: { page: 1, per_page: opts?.perPage ?? 10, total: 1 }
      }
    },
    async groupSearch(group, query, opts) {
      this.calls.groupSearch++
      this.lastArgs = { fn: 'groupSearch', group, query, opts }
      return {
        records: [{ id: 'G1', kind: 'feature' }],
        pagination: { page: opts?.page ?? 1, per_page: opts?.perPage ?? 20, total: 1 }
      }
    }
  }
}

describe('SearchEnabledDataLayer', () => {
  describe('searchNormalized', () => {
    it('routes through SearchService when a query is provided', async () => {
      const base = makeBase({ book: FakeModel })
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      const result = await layer.searchNormalized('book', 'hello', undefined, {
        page: 2,
        perPage: 30
      })

      expect(search.calls.search).toBe(1)
      expect(search.lastArgs.query).toBe('hello')
      expect(result.records).toEqual([{ id: 'S1', title: 'searched' }])
      expect(base.calls.listNormalized).toBe(0)
    })

    it('routes through SearchService when the model declares a query endpoint', async () => {
      const base = makeBase({ activity: FakeQueryableModel })
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      await layer.searchNormalized('activity', undefined, { status: 'live' })
      expect(search.calls.search).toBe(1)
    })

    it('routes through SearchService for nested-only models', async () => {
      const base = makeBase({ asset: FakeNestedModel })
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      await layer.searchNormalized('asset', undefined)
      expect(search.calls.search).toBe(1)
    })

    it('falls back to base.listNormalized for plain models with no query', async () => {
      const base = makeBase({ book: FakeModel })
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      const result = await layer.searchNormalized('book')
      expect(base.calls.listNormalized).toBe(1)
      expect(search.calls.search).toBe(0)
      expect(result.records).toEqual([{ id: 'L1' }])
    })

    it('delegates to the base when the model is unknown', async () => {
      const base = makeBase({})
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      await layer.searchNormalized('mystery')
      expect(base.calls.searchNormalized).toBe(1)
    })
  })

  describe('lookupNormalized', () => {
    it('routes through SearchService.lookup', async () => {
      const base = makeBase({ book: FakeModel })
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      const result = await layer.lookupNormalized('book', 'alpha', { perPage: 5 })

      expect(search.calls.lookup).toBe(1)
      expect(search.lastArgs).toMatchObject({ fn: 'lookup', query: 'alpha', opts: { perPage: 5 } })
      expect(result.records).toEqual([{ id: 'L1', title: 'looked-up' }])
    })

    it('delegates to the base when the model is unknown', async () => {
      const base = makeBase({})
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      await layer.lookupNormalized('mystery', 'x')
      expect(base.calls.lookupNormalized).toBe(1)
      expect(search.calls.lookup).toBe(0)
    })

    it('defaults perPage to 10', async () => {
      const base = makeBase({ book: FakeModel })
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      await layer.lookupNormalized('book', 'alpha')
      expect(search.lastArgs.opts.perPage).toBe(10)
    })
  })

  describe('groupSearchNormalized', () => {
    it('routes through SearchService.groupSearch', async () => {
      const base = makeBase({})
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      const result = await layer.groupSearchNormalized('catalogue', 'drama', { perPage: 7 })

      expect(search.calls.groupSearch).toBe(1)
      expect(search.lastArgs).toMatchObject({
        fn: 'groupSearch',
        group: 'catalogue',
        query: 'drama',
        opts: { perPage: 7 }
      })
      expect(result.records).toEqual([{ id: 'G1', kind: 'feature' }])
    })

    it('passes through optional models filter', async () => {
      const base = makeBase({})
      const search = makeSearch()
      const layer = new SearchEnabledDataLayer(base, search)

      await layer.groupSearchNormalized('catalogue', 'd', { models: ['episode', 'feature'] })
      expect(search.lastArgs.opts.models).toEqual(['episode', 'feature'])
    })
  })
})
