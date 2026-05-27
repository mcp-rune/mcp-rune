import { SearchAdapter } from '../../../../src/api-extensions/search/search-adapter.js'

describe('SearchAdapter', () => {
  const adapter = new SearchAdapter()
  const searchConfig = {
    query: {
      endpoint: 'items/search',
      method: 'POST' as const,
      queryParam: 'q'
    }
  }

  it('should build body with query and pagination', () => {
    const body = adapter.buildBody('test', undefined, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  it('should spread filters flat into the body', () => {
    const filters = { category_id: 4, status: 'active' }
    const body = adapter.buildBody('test', filters, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20,
      category_id: 4,
      status: 'active'
    })
  })

  it('should omit query param when query is null', () => {
    const body = adapter.buildBody(null, { theme_id: 1 }, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      page: 1,
      per_page: 20,
      theme_id: 1
    })
  })

  it('should omit query param when query is empty string', () => {
    const body = adapter.buildBody('', undefined, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      page: 1,
      per_page: 20
    })
  })

  it('should pass filters through unchanged (no transformation)', () => {
    const filters = { category_id: 4, duration_minutes: { from: 40 } }
    const body = adapter.buildBody('test', filters, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20,
      category_id: 4,
      duration_minutes: { from: 40 }
    })
  })

  it('should respect custom queryParam', () => {
    const config = { query: { queryParam: 'search' } }
    const body = adapter.buildBody('test', undefined, { page: 1, perPage: 10 }, config)

    expect(body).toEqual({
      search: 'test',
      page: 1,
      per_page: 10
    })
  })

  it('should not include filters when filters object is empty', () => {
    const body = adapter.buildBody('test', {}, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  it('should handle missing searchConfig gracefully', () => {
    const body = adapter.buildBody('test', undefined, { page: 1, perPage: 20 }, null)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  it('should ignore adapterConfig (base adapter does not use it)', () => {
    const config = {
      query: {
        queryParam: 'q',
        adapterConfig: { filtersParam: 'filters', rangeMappings: { x: { from: 'a', to: 'b' } } }
      }
    }
    const body = adapter.buildBody('test', { x: { from: 1 } }, { page: 1, perPage: 20 }, config)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20,
      x: { from: 1 }
    })
  })

  // ============================================================================
  // buildRequest()
  // ============================================================================

  describe('buildRequest', () => {
    it('should return body and null queryParams when no expand', () => {
      const result = adapter.buildRequest('test', undefined, { page: 1, perPage: 20 }, searchConfig)

      expect(result).toEqual({
        body: { q: 'test', page: 1, per_page: 20 },
        queryParams: null
      })
    })

    it('should return expand queryParams when expand is configured', () => {
      const configWithExpand = {
        query: {
          ...searchConfig.query,
          expand: ['title', 'platform']
        }
      }
      const result = adapter.buildRequest(
        'test',
        undefined,
        { page: 1, perPage: 20 },
        configWithExpand
      )

      expect(result).toEqual({
        body: { q: 'test', page: 1, per_page: 20 },
        queryParams: 'expand=title,platform'
      })
    })

    it('should return null queryParams when expand is empty array', () => {
      const configWithEmptyExpand = {
        query: {
          ...searchConfig.query,
          expand: []
        }
      }
      const result = adapter.buildRequest(
        'test',
        undefined,
        { page: 1, perPage: 20 },
        configWithEmptyExpand
      )

      expect(result.queryParams).toBeNull()
    })

    it('should include flat filters in body alongside expand queryParams', () => {
      const configWithExpand = {
        query: {
          ...searchConfig.query,
          expand: ['title']
        }
      }
      const result = adapter.buildRequest(
        'test',
        { category_id: 4 },
        { page: 1, perPage: 20 },
        configWithExpand
      )

      expect(result.body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        category_id: 4
      })
      expect(result.queryParams).toBe('expand=title')
    })

    it('should handle null searchConfig gracefully', () => {
      const result = adapter.buildRequest('test', undefined, { page: 1, perPage: 20 }, null)

      expect(result).toEqual({
        body: { q: 'test', page: 1, per_page: 20 },
        queryParams: null
      })
    })
  })
})
