import { RailsSearchRequestShaper } from '#src/mcp/data-layer/api-extensions/search/request-shapers/rails.js'

describe('RailsSearchRequestShaper', () => {
  // ============================================================================
  // filtersParam nesting
  // ============================================================================

  describe('filtersParam', () => {
    it('should nest filters under filtersParam from constructor', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = { query: { queryParam: 'q' } }
      const body = adapter.buildBody('test', { theme_id: 1 }, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        filters: { theme_id: 1 }
      })
    })

    it('should override constructor filtersParam with shaperConfig', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = {
        query: {
          queryParam: 'q',
          shaperConfig: { filtersParam: 'criteria' }
        }
      }
      const body = adapter.buildBody('test', { status: 'active' }, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        criteria: { status: 'active' }
      })
    })

    it('should fall back to flat spread when no filtersParam is set', () => {
      const adapter = new RailsSearchRequestShaper()
      const config = { query: { queryParam: 'q' } }
      const body = adapter.buildBody(
        'test',
        { category_id: 4, status: 'active' },
        { page: 1, perPage: 20 },
        config
      )

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        category_id: 4,
        status: 'active'
      })
    })

    it('should not include filters key when filters object is empty', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = { query: { queryParam: 'q' } }
      const body = adapter.buildBody('test', {}, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20
      })
    })

    it('should not include filters key when filters is undefined', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = { query: { queryParam: 'q' } }
      const body = adapter.buildBody('test', undefined, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20
      })
    })

    it('should omit query param when query is null', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = { query: { queryParam: 'q' } }
      const body = adapter.buildBody(null, { theme_id: 1 }, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        page: 1,
        per_page: 20,
        filters: { theme_id: 1 }
      })
    })
  })

  // ============================================================================
  // rangeMappings
  // ============================================================================

  describe('rangeMappings', () => {
    const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
    const configWithMappings = {
      query: {
        queryParam: 'q',
        shaperConfig: {
          rangeMappings: {
            duration_minutes: { from: 'min_duration', to: 'max_duration' },
            started_at: { from: 'started_after', to: 'started_before' }
          }
        }
      }
    }

    it('should flatten range filters with both from and to', () => {
      const filters = { duration_minutes: { from: 40, to: 120 } }
      const body = adapter.buildBody('test', filters, { page: 1, perPage: 20 }, configWithMappings)

      expect(body.filters).toEqual({ min_duration: 40, max_duration: 120 })
    })

    it('should flatten range filters with only from', () => {
      const filters = { started_at: { from: '2024-01-01' } }
      const body = adapter.buildBody(null, filters, { page: 1, perPage: 20 }, configWithMappings)

      expect(body.filters).toEqual({ started_after: '2024-01-01' })
    })

    it('should flatten range filters with only to', () => {
      const filters = { duration_minutes: { to: 120 } }
      const body = adapter.buildBody(null, filters, { page: 1, perPage: 20 }, configWithMappings)

      expect(body.filters).toEqual({ max_duration: 120 })
    })

    it('should pass non-range filters through unchanged', () => {
      const filters = { category_id: 4, duration_minutes: { from: 40 } }
      const body = adapter.buildBody(null, filters, { page: 1, perPage: 20 }, configWithMappings)

      expect(body.filters).toEqual({ category_id: 4, min_duration: 40 })
    })

    it('should not mutate the original filters object', () => {
      const filters = { duration_minutes: { from: 40, to: 120 }, category_id: 4 }
      const original = { ...filters }
      adapter.buildBody(null, filters, { page: 1, perPage: 20 }, configWithMappings)

      expect(filters).toEqual(original)
    })

    it('should handle mixed range and non-range filters', () => {
      const filters = {
        category_id: 4,
        duration_minutes: { from: 40, to: 120 },
        started_at: { from: '2024-01-01' },
        theme_id: 1
      }
      const body = adapter.buildBody('q', filters, { page: 1, perPage: 20 }, configWithMappings)

      expect(body.filters).toEqual({
        category_id: 4,
        min_duration: 40,
        max_duration: 120,
        started_after: '2024-01-01',
        theme_id: 1
      })
    })
  })

  // ============================================================================
  // rangeMappings without filtersParam (flat spread with range flattening)
  // ============================================================================

  describe('rangeMappings without filtersParam', () => {
    it('should flatten ranges and spread flat when no filtersParam', () => {
      const adapter = new RailsSearchRequestShaper()
      const config = {
        query: {
          queryParam: 'q',
          shaperConfig: {
            rangeMappings: {
              duration_minutes: { from: 'min_duration', to: 'max_duration' }
            }
          }
        }
      }
      const filters = { duration_minutes: { from: 40, to: 120 }, category_id: 4 }
      const body = adapter.buildBody('test', filters, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        min_duration: 40,
        max_duration: 120,
        category_id: 4
      })
    })
  })

  // ============================================================================
  // combined filtersParam + rangeMappings
  // ============================================================================

  describe('combined filtersParam and rangeMappings', () => {
    it('should nest range-mapped filters under filtersParam', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = {
        query: {
          queryParam: 'q',
          shaperConfig: {
            rangeMappings: {
              duration_minutes: { from: 'min_duration', to: 'max_duration' }
            }
          }
        }
      }
      const filters = { category_id: 4, duration_minutes: { from: 40, to: 120 } }
      const body = adapter.buildBody('test', filters, { page: 1, perPage: 20 }, config)

      expect(body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        filters: { category_id: 4, min_duration: 40, max_duration: 120 }
      })
    })
  })

  // ============================================================================
  // buildRequest (inherits expand from base)
  // ============================================================================

  describe('buildRequest', () => {
    it('should support expand queryParams alongside nested filters', () => {
      const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
      const config = {
        query: {
          queryParam: 'q',
          expand: ['title', 'platform']
        }
      }
      const result = adapter.buildRequest(
        'test',
        { category_id: 4 },
        { page: 1, perPage: 20 },
        config
      )

      expect(result.body).toEqual({
        q: 'test',
        page: 1,
        per_page: 20,
        filters: { category_id: 4 }
      })
      expect(result.queryParams).toBe('expand=title,platform')
    })
  })
})
