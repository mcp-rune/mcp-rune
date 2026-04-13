import { SearchAdapter } from '../../../../src/mcp/search/search-adapter.js'

describe('SearchAdapter', () => {
  const adapter = new SearchAdapter()
  const searchConfig = {
    fullText: {
      endpoint: 'items/search',
      method: 'POST',
      queryParam: 'q',
      filtersParam: 'filters'
    }
  }

  it('should build body with query and pagination', () => {
    const body = adapter.buildBody('test', null, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  it('should omit query param when query is null', () => {
    const body = adapter.buildBody(null, { theme_id: 1 }, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      page: 1,
      per_page: 20,
      filters: { theme_id: 1 }
    })
  })

  it('should omit query param when query is empty string', () => {
    const body = adapter.buildBody('', null, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      page: 1,
      per_page: 20
    })
  })

  it('should pass filters through unchanged', () => {
    const filters = { category_id: 4, duration_minutes: { from: 40 } }
    const body = adapter.buildBody('test', filters, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20,
      filters: { category_id: 4, duration_minutes: { from: 40 } }
    })
  })

  it('should respect custom queryParam', () => {
    const config = {
      fullText: { queryParam: 'search', filtersParam: 'filters' }
    }
    const body = adapter.buildBody('test', null, { page: 1, perPage: 10 }, config)

    expect(body).toEqual({
      search: 'test',
      page: 1,
      per_page: 10
    })
  })

  it('should not include filters when filtersParam is not defined', () => {
    const config = { fullText: { queryParam: 'q' } }
    const body = adapter.buildBody('test', { some: 'filter' }, { page: 1, perPage: 20 }, config)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  it('should not include filters key when filters object is empty', () => {
    const body = adapter.buildBody('test', {}, { page: 1, perPage: 20 }, searchConfig)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  it('should handle missing searchConfig gracefully', () => {
    const body = adapter.buildBody('test', null, { page: 1, perPage: 20 }, null)

    expect(body).toEqual({
      q: 'test',
      page: 1,
      per_page: 20
    })
  })

  // ============================================================================
  // buildRequest()
  // ============================================================================

  describe('buildRequest', () => {
    it('should return body and null queryParams when no expand', () => {
      const result = adapter.buildRequest('test', null, { page: 1, perPage: 20 }, searchConfig)

      expect(result).toEqual({
        body: { q: 'test', page: 1, per_page: 20 },
        queryParams: null
      })
    })

    it('should return expand queryParams when expand is configured', () => {
      const configWithExpand = {
        fullText: {
          ...searchConfig.fullText,
          expand: ['title', 'platform']
        }
      }
      const result = adapter.buildRequest('test', null, { page: 1, perPage: 20 }, configWithExpand)

      expect(result).toEqual({
        body: { q: 'test', page: 1, per_page: 20 },
        queryParams: 'expand=title,platform'
      })
    })

    it('should return null queryParams when expand is empty array', () => {
      const configWithEmptyExpand = {
        fullText: {
          ...searchConfig.fullText,
          expand: []
        }
      }
      const result = adapter.buildRequest(
        'test',
        null,
        { page: 1, perPage: 20 },
        configWithEmptyExpand
      )

      expect(result.queryParams).toBeNull()
    })

    it('should include filters in body alongside expand queryParams', () => {
      const configWithExpand = {
        fullText: {
          ...searchConfig.fullText,
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
        filters: { category_id: 4 }
      })
      expect(result.queryParams).toBe('expand=title')
    })

    it('should handle null searchConfig gracefully', () => {
      const result = adapter.buildRequest('test', null, { page: 1, perPage: 20 }, null)

      expect(result).toEqual({
        body: { q: 'test', page: 1, per_page: 20 },
        queryParams: null
      })
    })
  })
})
