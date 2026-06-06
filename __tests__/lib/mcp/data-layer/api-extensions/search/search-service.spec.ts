import { RailsSearchAdapter } from '#src/mcp/data-layer/api-extensions/search/rails-search-adapter.js'
import { SearchService } from '#src/mcp/data-layer/api-extensions/search/search-service.js'
import { ModelService } from '#src/mcp/data-layer/model-service/model-service.js'

import { flatConvention } from '../../../../../__fixtures__/flat-convention.js'

// Mock model classes
const DirectSearchModel = {
  api: { endpoint: 'activities' },
  singularName: 'activity',
  extensions: {
    search: {
      query: {
        endpoint: 'activities/search',
        method: 'POST' as const,
        queryParam: 'q'
      },
      lookup: { fields: ['title', 'description'] }
    }
  }
}

const GroupSearchModel = {
  api: { endpoint: 'books' },
  singularName: 'book',
  extensions: {
    search: {
      query: { group: 'library' },
      lookup: { fields: ['title', 'author'] }
    }
  }
}

const ListOnlyModel = {
  api: { endpoint: 'brands' },
  singularName: 'brand',
  extensions: { search: { lookup: { fields: ['name'] } } }
}

const NoSearchableModel = {
  api: { endpoint: 'settings' },
  singularName: 'setting',
  search: null
}

const searchGroups = {
  library: {
    name: 'Library',
    endpoint: 'library/search',
    method: 'POST',
    queryParam: 'q',
    modelsParam: 'models',
    typeField: 'searchable_type',
    models: ['book', 'category', 'tag']
  }
}

describe('SearchService', () => {
  let mockApiClient
  let client

  beforeEach(() => {
    mockApiClient = {
      get: vi.fn().mockResolvedValue({
        data: [{ id: 1, name: 'Test' }],
        meta: { page: 1, per_page: 20, total: 1 }
      }),
      post: vi.fn().mockResolvedValue({
        records: [{ id: 1, title: 'Result' }],
        pagination: { page: 1, per_page: 20, total: 1 }
      })
    }
    client = new SearchService(new ModelService({ apiClient: mockApiClient, models: {} }), {
      searchGroups
    })
  })

  // ============================================================================
  // search() — direct endpoint
  // ============================================================================

  describe('search() with direct endpoint', () => {
    it('should POST to the model search endpoint', async () => {
      await client.search(DirectSearchModel, 'test query')

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test query',
        page: 1,
        per_page: 20
      })
    })

    it('should spread filters flat into the body by default', async () => {
      await client.search(DirectSearchModel, 'test', {
        filters: { theme_id: 1, status: 'active' }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 20,
        theme_id: 1,
        status: 'active'
      })
    })

    it('should pass page and perPage', async () => {
      await client.search(DirectSearchModel, 'test', { page: 3, perPage: 10 })

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 3,
        per_page: 10
      })
    })

    it('should return normalized records and pagination', async () => {
      const result = await client.search(DirectSearchModel, 'test')

      expect(result.records).toEqual([{ id: 1, title: 'Result' }])
      expect(result.pagination).toEqual({ page: 1, per_page: 20, total: 1 })
    })

    it('should handle GET method search endpoints', async () => {
      const getSearchModel = {
        ...DirectSearchModel,
        extensions: {
          search: {
            query: { endpoint: 'items/search', method: 'GET' as const, queryParam: 'q' }
          }
        }
      }

      await client.search(getSearchModel, 'test')

      expect(mockApiClient.get).toHaveBeenCalledWith('items/search', {
        q: 'test',
        page: 1,
        per_page: 20
      })
    })

    it('should use custom adapter when declared on model', async () => {
      const customAdapter = {
        buildRequest: vi.fn().mockReturnValue({
          body: {
            q: 'test',
            page: 1,
            per_page: 20,
            filters: { min_duration: 40 }
          },
          queryParams: null
        })
      }
      const modelWithAdapter = {
        ...DirectSearchModel,
        extensions: {
          search: {
            ...DirectSearchModel.extensions.search,
            query: {
              ...DirectSearchModel.extensions.search.query,
              adapter: customAdapter
            }
          }
        }
      }

      await client.search(modelWithAdapter, 'test', {
        filters: { duration_minutes: { from: 40 } }
      })

      expect(customAdapter.buildRequest).toHaveBeenCalledWith(
        'test',
        { duration_minutes: { from: 40 } },
        { page: 1, perPage: 20 },
        modelWithAdapter.extensions.search
      )
      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 20,
        filters: { min_duration: 40 }
      })
    })

    it('should spread filters flat when using default adapter', async () => {
      await client.search(DirectSearchModel, 'test', {
        filters: { category_id: 4 }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 20,
        category_id: 4
      })
    })

    it('should append expand query params to POST URL when configured', async () => {
      const modelWithExpand = {
        ...DirectSearchModel,
        extensions: {
          search: {
            ...DirectSearchModel.extensions.search,
            query: {
              ...DirectSearchModel.extensions.search.query,
              expand: ['title', 'platform']
            }
          }
        }
      }

      await client.search(modelWithExpand, 'test')

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search?expand=title,platform', {
        q: 'test',
        page: 1,
        per_page: 20
      })
    })

    it('should not append query params when no expand configured', async () => {
      await client.search(DirectSearchModel, 'test')

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 20
      })
    })
  })

  // ============================================================================
  // defaultAdapter
  // ============================================================================

  describe('defaultAdapter', () => {
    it('should use the provided defaultAdapter for direct search', async () => {
      const railsClient = new SearchService(
        new ModelService({ apiClient: mockApiClient, models: {} }),
        {
          searchGroups,
          defaultAdapter: new RailsSearchAdapter({ filtersParam: 'filters' })
        }
      )

      await railsClient.search(DirectSearchModel, 'test', {
        filters: { theme_id: 1 }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 20,
        filters: { theme_id: 1 }
      })
    })

    it('should use the provided defaultAdapter for group search', async () => {
      const railsClient = new SearchService(
        new ModelService({ apiClient: mockApiClient, models: {} }),
        {
          searchGroups,
          defaultAdapter: new RailsSearchAdapter({ filtersParam: 'filters' })
        }
      )

      await railsClient.groupSearch('library', 'ruby', {
        filters: { tag_id: 5 }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'ruby',
        page: 1,
        per_page: 20,
        filters: { tag_id: 5 }
      })
    })

    it('should allow per-model adapter to override defaultAdapter', async () => {
      const customAdapter = {
        buildRequest: vi.fn().mockReturnValue({
          body: { q: 'test', page: 1, per_page: 20, custom: true },
          queryParams: null
        })
      }
      const modelWithAdapter = {
        ...DirectSearchModel,
        extensions: {
          search: {
            ...DirectSearchModel.search,
            query: { ...DirectSearchModel.extensions.search.query, adapter: customAdapter }
          }
        }
      }

      const railsClient = new SearchService(
        new ModelService({ apiClient: mockApiClient, models: {} }),
        {
          defaultAdapter: new RailsSearchAdapter({ filtersParam: 'filters' })
        }
      )

      await railsClient.search(modelWithAdapter, 'test')

      expect(customAdapter.buildRequest).toHaveBeenCalled()
    })

    it('should allow per-group adapter to override defaultAdapter', async () => {
      const customAdapter = {
        buildBody: vi.fn().mockReturnValue({
          q: 'test',
          page: 1,
          per_page: 20,
          criteria: { custom: true }
        })
      }
      const customGroups = {
        library: { ...searchGroups.library, adapter: customAdapter }
      }
      const railsClient = new SearchService(
        new ModelService({ apiClient: mockApiClient, models: {} }),
        {
          searchGroups: customGroups,
          defaultAdapter: new RailsSearchAdapter({ filtersParam: 'filters' })
        }
      )

      await railsClient.groupSearch('library', 'test')

      expect(customAdapter.buildBody).toHaveBeenCalled()
    })

    it('should default to base SearchAdapter when no defaultAdapter provided', async () => {
      const plainClient = new SearchService(
        new ModelService({ apiClient: mockApiClient, models: {} }),
        { searchGroups }
      )

      await plainClient.search(DirectSearchModel, 'test', {
        filters: { status: 'active' }
      })

      // Base adapter spreads flat
      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 20,
        status: 'active'
      })
    })
  })

  // ============================================================================
  // search() — group search
  // ============================================================================

  describe('search() with group search', () => {
    it('should POST to the group search endpoint with model type filter', async () => {
      await client.search(GroupSearchModel, 'clean code')

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'clean code',
        page: 1,
        per_page: 20,
        models: ['book']
      })
    })

    it('should pass page and perPage through to group search', async () => {
      await client.search(GroupSearchModel, 'test', { page: 2, perPage: 10 })

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'test',
        page: 2,
        per_page: 10,
        models: ['book']
      })
    })

    it('should use query.modelName when set (string)', async () => {
      const ModelWithModelName = {
        api: { endpoint: 'title_groups' },
        singularName: 'title_group',
        extensions: {
          search: {
            query: { group: 'library', modelName: 'series' }
          }
        }
      }

      await client.search(ModelWithModelName, 'breaking bad')

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'breaking bad',
        page: 1,
        per_page: 20,
        models: ['series']
      })
    })

    it('should use query.modelName when set (array)', async () => {
      const ModelWithMultipleNames = {
        api: { endpoint: 'titles' },
        singularName: 'title',
        extensions: {
          search: {
            query: { group: 'library', modelName: ['episode', 'feature'] }
          }
        }
      }

      await client.search(ModelWithMultipleNames, 'drama')

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'drama',
        page: 1,
        per_page: 20,
        models: ['episode', 'feature']
      })
    })

    it('should fall back to singularName when query.modelName is not set', async () => {
      // GroupSearchModel has no modelName — should use singularName 'book'
      await client.search(GroupSearchModel, 'test')

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'test',
        page: 1,
        per_page: 20,
        models: ['book']
      })
    })
  })

  // ============================================================================
  // search() — list-only fallback
  // ============================================================================

  describe('search() with list-only fallback', () => {
    it('should fall back to list with field-based search', async () => {
      await client.search(ListOnlyModel, 'test query')

      expect(mockApiClient.get).toHaveBeenCalledWith('brands', {
        page: 1,
        per_page: 20,
        name: 'test query'
      })
    })

    it('should fall back to plain list when no searchable fields', async () => {
      await client.search(NoSearchableModel, 'test')

      expect(mockApiClient.get).toHaveBeenCalledWith('settings', {
        page: 1,
        per_page: 20
      })
    })

    it('should fall back to plain list when no query provided', async () => {
      await client.search(ListOnlyModel, null)

      expect(mockApiClient.get).toHaveBeenCalledWith('brands', {
        page: 1,
        per_page: 20
      })
    })
  })

  // ============================================================================
  // lookup()
  // ============================================================================

  describe('lookup()', () => {
    it('should use dedicated lookup endpoint when configured', async () => {
      const modelWithLookupEndpoint = {
        api: { endpoint: 'brands' },
        singularName: 'brand',
        extensions: {
          search: {
            query: { group: 'catalogue' },
            lookup: { endpoint: 'brands/autocomplete', fields: ['name'] }
          }
        }
      }

      await client.lookup(modelWithLookupEndpoint, 'Breaking')

      expect(mockApiClient.get).toHaveBeenCalledWith('brands/autocomplete', {
        per_page: 10,
        name: 'Breaking'
      })
    })

    it('should use custom queryParam for dedicated lookup endpoint', async () => {
      const modelWithQueryParam = {
        api: { endpoint: 'brands' },
        singularName: 'brand',
        extensions: {
          search: {
            lookup: { endpoint: 'brands/autocomplete', fields: ['name'], queryParam: 'q' }
          }
        }
      }

      await client.lookup(modelWithQueryParam, 'test')

      expect(mockApiClient.get).toHaveBeenCalledWith('brands/autocomplete', {
        per_page: 10,
        q: 'test'
      })
    })

    it('should fall back to search() when query config exists but no lookup endpoint', async () => {
      await client.lookup(DirectSearchModel, 'test')

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 10
      })
    })

    it('should fall back to list() with field filter when no query or lookup endpoint', async () => {
      await client.lookup(ListOnlyModel, 'test')

      expect(mockApiClient.get).toHaveBeenCalledWith('brands', {
        page: 1,
        per_page: 10,
        name: 'test'
      })
    })

    it('should fall back to plain list when no lookup fields and no query config', async () => {
      await client.lookup(NoSearchableModel, 'test')

      expect(mockApiClient.get).toHaveBeenCalledWith('settings', {
        page: 1,
        per_page: 10
      })
    })

    it('should respect custom perPage', async () => {
      await client.lookup(DirectSearchModel, 'test', { perPage: 5 })

      expect(mockApiClient.post).toHaveBeenCalledWith('activities/search', {
        q: 'test',
        page: 1,
        per_page: 5
      })
    })
  })

  // ============================================================================
  // groupSearch()
  // ============================================================================

  describe('groupSearch()', () => {
    it('should POST to the group endpoint with query', async () => {
      await client.groupSearch('library', 'clean code')

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'clean code',
        page: 1,
        per_page: 20
      })
    })

    it('should scope to subset of models', async () => {
      await client.groupSearch('library', 'clean code', {
        models: ['book', 'category']
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'clean code',
        page: 1,
        per_page: 20,
        models: ['book', 'category']
      })
    })

    it('should pass page and perPage', async () => {
      await client.groupSearch('library', 'test', { page: 2, perPage: 5 })

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'test',
        page: 2,
        per_page: 5
      })
    })

    it('should throw for unknown group', async () => {
      await expect(client.groupSearch('nonexistent', 'test')).rejects.toThrow(
        'Unknown search group: "nonexistent"'
      )
    })

    it('should not include models param when no subset specified', async () => {
      await client.groupSearch('library', 'test')

      const callArgs = mockApiClient.post.mock.calls[0][1]
      expect(callArgs).not.toHaveProperty('models')
    })

    it('should not include models param when empty array', async () => {
      await client.groupSearch('library', 'test', { models: [] })

      const callArgs = mockApiClient.post.mock.calls[0][1]
      expect(callArgs).not.toHaveProperty('models')
    })

    it('should spread filters flat with default adapter', async () => {
      await client.groupSearch('library', 'ruby', {
        filters: { tag_id: 5 }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'ruby',
        page: 1,
        per_page: 20,
        tag_id: 5
      })
    })

    it('should omit filters when no filters provided', async () => {
      await client.groupSearch('library', 'test')

      const callArgs = mockApiClient.post.mock.calls[0][1]
      expect(callArgs).not.toHaveProperty('filters')
      expect(callArgs).not.toHaveProperty('tag_id')
    })

    it('should use custom adapter when declared on group config', async () => {
      const customAdapter = {
        buildBody: vi.fn().mockReturnValue({
          q: 'test',
          page: 1,
          per_page: 20,
          filters: { custom: true }
        })
      }
      const customGroups = {
        library: { ...searchGroups.library, adapter: customAdapter }
      }
      const customClient = new SearchService(
        new ModelService({ apiClient: mockApiClient, models: {} }),
        { searchGroups: customGroups }
      )

      await customClient.groupSearch('library', 'test', {
        filters: { tag_id: 3 }
      })

      expect(customAdapter.buildBody).toHaveBeenCalledWith(
        'test',
        { tag_id: 3 },
        { page: 1, perPage: 20 },
        { query: customGroups.library }
      )
    })
  })

  // ============================================================================
  // search() — group search with filters
  // ============================================================================

  describe('search() with group model passes filters through', () => {
    it('should forward filters to groupSearch (flat spread)', async () => {
      await client.search(GroupSearchModel, 'Haskell', {
        filters: { tag_id: 5 }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('library/search', {
        q: 'Haskell',
        page: 1,
        per_page: 20,
        models: ['book'],
        tag_id: 5
      })
    })
  })

  // ============================================================================
  // list()
  // ============================================================================

  describe('list()', () => {
    it('should GET the model endpoint with pagination', async () => {
      await client.list(GroupSearchModel)

      expect(mockApiClient.get).toHaveBeenCalledWith('books', {
        page: 1,
        per_page: 20
      })
    })

    it('should pass page, perPage, and sort', async () => {
      await client.list(GroupSearchModel, { page: 3, perPage: 50, sort: 'title' })

      expect(mockApiClient.get).toHaveBeenCalledWith('books', {
        page: 3,
        per_page: 50,
        sort: 'title'
      })
    })

    it('should pass field filters', async () => {
      await client.list(GroupSearchModel, { status: 'reading', author: 'Martin' })

      expect(mockApiClient.get).toHaveBeenCalledWith('books', {
        page: 1,
        per_page: 20,
        status: 'reading',
        author: 'Martin'
      })
    })

    it('should normalize array response', async () => {
      mockApiClient.get.mockResolvedValue([{ id: 1 }, { id: 2 }])

      const result = await client.list(GroupSearchModel)

      expect(result.records).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.pagination).toEqual({ page: 1, per_page: 20, total: 2 })
    })

    it('should handle HAL _embedded response via convention', async () => {
      const HalModel = {
        singularName: 'platform',
        api: { endpoint: 'platforms', convention: flatConvention }
      }

      mockApiClient.get.mockResolvedValue({
        _embedded: { platforms: [{ id: 1, name: 'Netflix' }] },
        total_count: 42
      })

      const result = await client.list(HalModel)
      expect(result.records).toEqual([{ id: 1, name: 'Netflix' }])
      expect(result.pagination.total).toBe(42)
    })

    it('should normalize response with data and meta', async () => {
      mockApiClient.get.mockResolvedValue({
        data: [{ id: 1 }],
        meta: { page: 2, per_page: 10, total: 50 }
      })

      const result = await client.list(GroupSearchModel, { page: 2, perPage: 10 })

      expect(result.records).toEqual([{ id: 1 }])
      expect(result.pagination).toEqual({ page: 2, per_page: 10, total: 50 })
    })
  })

  // ============================================================================
  // Static capability methods
  // ============================================================================

  describe('getSearchCapability()', () => {
    it('should return "direct" for models with search endpoint', () => {
      expect(SearchService.getSearchCapability(DirectSearchModel)).toBe('direct')
    })

    it('should return "group" for models with group search', () => {
      expect(SearchService.getSearchCapability(GroupSearchModel)).toBe('group')
    })

    it('should return "list-only" for models without search config', () => {
      expect(SearchService.getSearchCapability(ListOnlyModel)).toBe('list-only')
    })

    it('should return "list-only" when search is null', () => {
      expect(SearchService.getSearchCapability(NoSearchableModel)).toBe('list-only')
    })
  })

  describe('getLookupCapability()', () => {
    it('should return "dedicated" for models with lookup endpoint', () => {
      const model = {
        api: { endpoint: 'brands' },
        extensions: { search: { lookup: { endpoint: 'brands/autocomplete', fields: ['name'] } } }
      }
      expect(SearchService.getLookupCapability(model)).toBe('dedicated')
    })

    it('should return "search-fallback" for models with query config but no lookup endpoint', () => {
      expect(SearchService.getLookupCapability(DirectSearchModel)).toBe('search-fallback')
    })

    it('should return "list-fallback" for models with only lookup fields', () => {
      expect(SearchService.getLookupCapability(ListOnlyModel)).toBe('list-fallback')
    })

    it('should return "list-fallback" when search is null', () => {
      expect(SearchService.getLookupCapability(NoSearchableModel)).toBe('list-fallback')
    })
  })

  describe('getSearchGroup()', () => {
    it('should return group name for group search models', () => {
      expect(SearchService.getSearchGroup(GroupSearchModel)).toBe('library')
    })

    it('should return null for direct search models', () => {
      expect(SearchService.getSearchGroup(DirectSearchModel)).toBeNull()
    })

    it('should return null for list-only models', () => {
      expect(SearchService.getSearchGroup(ListOnlyModel)).toBeNull()
    })
  })

  // ============================================================================
  // Response normalization
  // ============================================================================

  describe('response normalization', () => {
    it('should handle response with records key', async () => {
      mockApiClient.post.mockResolvedValue({
        records: [{ id: 1 }],
        pagination: { page: 1, per_page: 20, total: 1 }
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([{ id: 1 }])
    })

    it('should handle response with data key', async () => {
      mockApiClient.post.mockResolvedValue({
        data: [{ id: 2 }],
        pagination: { page: 1, per_page: 20, total: 1 }
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([{ id: 2 }])
    })

    it('should handle raw array response', async () => {
      mockApiClient.post.mockResolvedValue([{ id: 3 }])

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([{ id: 3 }])
    })

    it('should use meta as pagination fallback', async () => {
      mockApiClient.post.mockResolvedValue({
        records: [{ id: 1 }],
        meta: { page: 2, per_page: 10, total: 100 }
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.pagination).toEqual({ page: 2, per_page: 10, total: 100 })
    })

    it('should construct pagination from total when pagination/meta missing', async () => {
      mockApiClient.post.mockResolvedValue({
        records: [{ id: 1 }],
        total: 42
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.pagination.total).toBe(42)
    })

    it('should default total to records length when all pagination missing', async () => {
      mockApiClient.post.mockResolvedValue({
        records: [{ id: 1 }, { id: 2 }]
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.pagination.total).toBe(2)
    })

    it('should handle HAL _embedded response format', async () => {
      mockApiClient.post.mockResolvedValue({
        _embedded: {
          schedulings: [
            { id: 1, title: 'Schedule A' },
            { id: 2, title: 'Schedule B' }
          ]
        },
        total_count: 25,
        total_pages: 2
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([
        { id: 1, title: 'Schedule A' },
        { id: 2, title: 'Schedule B' }
      ])
      expect(result.pagination.total).toBe(25)
      expect(result.pagination.total_pages).toBe(2)
    })

    it('should handle HAL _embedded with empty array', async () => {
      mockApiClient.post.mockResolvedValue({
        _embedded: { schedulings: [] },
        total_count: 0,
        total_pages: 0
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([])
      expect(result.pagination.total).toBe(0)
    })

    it('should handle model-keyed top-level array response', async () => {
      mockApiClient.post.mockResolvedValue({
        schedulings: [{ id: 1 }, { id: 2 }],
        total_count: 50,
        total_pages: 5
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([{ id: 1 }, { id: 2 }])
      expect(result.pagination.total).toBe(50)
      expect(result.pagination.total_pages).toBe(5)
    })

    it('should use total_count for pagination when available', async () => {
      mockApiClient.post.mockResolvedValue({
        records: [{ id: 1 }],
        total_count: 100,
        total_pages: 5
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.pagination.total).toBe(100)
      expect(result.pagination.total_pages).toBe(5)
    })

    it('should return empty records when response has no recognizable format', async () => {
      mockApiClient.post.mockResolvedValue({
        status: 'ok',
        message: 'no results'
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([])
    })

    it('should ignore _links when looking for model-keyed arrays', async () => {
      mockApiClient.post.mockResolvedValue({
        _links: ['self', 'next'],
        items: [{ id: 1 }],
        total_count: 1
      })

      const result = await client.search(DirectSearchModel, 'test')
      expect(result.records).toEqual([{ id: 1 }])
    })
  })
})
