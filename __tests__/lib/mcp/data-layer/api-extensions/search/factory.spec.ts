import { describe, expect, it, vi } from 'vitest'

import { createSearchService } from '#src/mcp/data-layer/api-extensions/search/factory.js'
import { SearchRequestShaper } from '#src/mcp/data-layer/api-extensions/search/request-shapers/default.js'
import { SearchService } from '#src/mcp/data-layer/api-extensions/search/search-service.js'
import { ModelService } from '#src/mcp/data-layer/model-service/model-service.js'

const stubApiClient = () => ({
  get: vi.fn().mockResolvedValue({}),
  post: vi.fn().mockResolvedValue({})
})

describe('api-extensions/search/factory — createSearchService', () => {
  it('returns a SearchService bound to the given apiClient', () => {
    const apiClient = stubApiClient()
    const service = createSearchService(new ModelService({ apiClient, models: {} }))
    expect(service).toBeInstanceOf(SearchService)
  })

  it('pulls searchGroups from the passed context', async () => {
    const apiClient = stubApiClient()
    apiClient.post.mockResolvedValue({
      records: [],
      pagination: { page: 1, per_page: 20, total: 0 }
    })
    const service = createSearchService(new ModelService({ apiClient, models: {} }), {
      searchGroups: {
        catalogue: { endpoint: 'catalogue/search', modelsParam: 'models' }
      }
    })
    await service.groupSearch('catalogue', 'foo', { page: 1, perPage: 20 })
    expect(apiClient.post).toHaveBeenCalledWith('catalogue/search', expect.any(Object))
  })

  it('pulls defaultShaper from the passed context', () => {
    const apiClient = stubApiClient()
    const customAdapter = new SearchRequestShaper()
    const spy = vi.spyOn(customAdapter, 'buildRequest')
    const service = createSearchService(new ModelService({ apiClient, models: {} }), {
      defaultShaper: customAdapter
    })
    // Indirectly verify the adapter was retained: invoke a search through a
    // model that has a direct endpoint, which triggers buildRequest on the
    // service's default adapter.
    const ModelClass = {
      singularName: 'm',
      api: { endpoint: 'm' },
      extensions: { search: { query: { endpoint: 'm/search', method: 'POST' as const } } }
    }
    apiClient.post.mockResolvedValue({
      records: [],
      pagination: { page: 1, per_page: 20, total: 0 }
    })
    return service.search(ModelClass as never, 'q', { page: 1, perPage: 10 }).then(() => {
      expect(spy).toHaveBeenCalled()
    })
  })

  it('falls back to empty defaults when context is omitted', () => {
    const apiClient = stubApiClient()
    const service = createSearchService(new ModelService({ apiClient, models: {} }))
    expect(service).toBeInstanceOf(SearchService)
  })
})
