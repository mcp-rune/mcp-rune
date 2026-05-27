import { jsonApiConvention } from '../../../../src/mcp/api-conventions/index.js'
import type { ApiClient } from '../../../../src/mcp/search/types.js'
import {
  MissingRequiredFieldsError,
  ModelReadOnlyError,
  ModelService,
  UnknownModelError
} from '../../../../src/mcp/services/model-service.js'
import type { ModelConfig } from '../../../../src/mcp/tools/base-tool.js'

describe('lib/mcp/services/model-service', () => {
  // =========================================================================
  // Helpers
  // =========================================================================

  function makeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
    return {
      baseUrl: 'https://api.example.com',
      get: vi.fn().mockResolvedValue({ id: '1', name: 'test' }),
      post: vi.fn().mockResolvedValue({ id: '1', name: 'created' }),
      put: vi.fn().mockResolvedValue({ id: '1', name: 'replaced' }),
      patch: vi.fn().mockResolvedValue({ id: '1', name: 'updated' }),
      delete: vi.fn().mockResolvedValue({}),
      ...overrides
    }
  }

  function makeModels(): Record<string, ModelConfig> {
    return {
      book: {
        attributes: {
          title: { type: 'string', required: true },
          author: { type: 'string', required: true },
          status: { type: 'enum' }
        },
        required: ['title', 'author'],
        description: 'A book record',
        api: { endpoint: 'books', convention: jsonApiConvention },
        associations: {
          belongsTo: {
            publisher: { rel: 'publisher', target_model: 'publisher' }
          }
        }
      },
      review: {
        attributes: { rating: { type: 'integer' } },
        description: 'Read-only review data',
        api: { endpoint: 'reviews', readOnly: true }
      },
      scheduling: {
        attributes: { start_date: { type: 'string' } },
        required: [],
        api: {
          endpoint: 'schedulings',
          parent: 'book',
          standalone: false
        }
      }
    }
  }

  function makeService(
    apiOverrides?: Partial<ApiClient>,
    modelsOverride?: Record<string, ModelConfig>
  ) {
    const apiClient = makeApiClient(apiOverrides)
    return {
      service: new ModelService({
        apiClient,
        models: modelsOverride ?? makeModels()
      }),
      apiClient
    }
  }

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('posts to the model endpoint with convention payload', async () => {
      const { service, apiClient } = makeService()
      await service.create('book', { title: 'Test', author: 'Author' })

      expect(apiClient.post).toHaveBeenCalledWith(
        'books',
        { book: { title: 'Test', author: 'Author' } },
        undefined
      )
    })

    it('passes request options (userId) through', async () => {
      const { service, apiClient } = makeService()
      await service.create('book', { title: 'Test', author: 'Author' }, { userId: 'u1' })

      expect(apiClient.post).toHaveBeenCalledWith('books', expect.any(Object), { userId: 'u1' })
    })

    it('throws MissingRequiredFieldsError when required fields are missing', async () => {
      const { service } = makeService()
      await expect(service.create('book', { title: 'Test' })).rejects.toThrow(
        MissingRequiredFieldsError
      )
    })

    it('throws ModelReadOnlyError for read-only models', async () => {
      const { service } = makeService()
      await expect(service.create('review', { rating: 5 })).rejects.toThrow(ModelReadOnlyError)
    })

    it('throws UnknownModelError for unknown models', async () => {
      const { service } = makeService()
      await expect(service.create('nonexistent', {})).rejects.toThrow(UnknownModelError)
    })

    it('resolves nested endpoint when parentPath provided', async () => {
      const { service, apiClient } = makeService()
      await service.create(
        'scheduling',
        { start_date: '2026-01-01' },
        { parentPath: 'books/42/schedulings' }
      )

      expect(apiClient.post).toHaveBeenCalledWith('books/42/schedulings', expect.any(Object), {
        parentPath: 'books/42/schedulings'
      })
    })

    it('throws MissingParentError for nested-only model without parentPath', async () => {
      const { service } = makeService()
      await expect(service.create('scheduling', { start_date: '2026-01-01' })).rejects.toThrow(
        /nested-only/
      )
    })

    it('enriches MissingParentError with concrete parent endpoint path', async () => {
      const { service } = makeService()
      await expect(service.create('scheduling', { start_date: '2026-01-01' })).rejects.toThrow(
        /books\/\{id\}\/schedulings/
      )
    })

    it('returns raw API response', async () => {
      const { service } = makeService()
      const result = await service.create('book', { title: 'Test', author: 'Author' })
      expect(result).toEqual({ id: '1', name: 'created' })
    })
  })

  // =========================================================================
  // find
  // =========================================================================

  describe('find', () => {
    it('gets from endpoint/recordId', async () => {
      const { service, apiClient } = makeService()
      await service.find('book', '123')

      expect(apiClient.get).toHaveBeenCalledWith('books/123', {}, undefined)
    })

    it('passes request options through', async () => {
      const { service, apiClient } = makeService()
      await service.find('book', '123', { userId: 'u1' })

      expect(apiClient.get).toHaveBeenCalledWith('books/123', {}, { userId: 'u1' })
    })

    it('throws UnknownModelError for unknown models', async () => {
      const { service } = makeService()
      await expect(service.find('nonexistent', '1')).rejects.toThrow(UnknownModelError)
    })
  })

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('gets from endpoint with default pagination', async () => {
      const { service, apiClient } = makeService()
      await service.list('book')

      expect(apiClient.get).toHaveBeenCalledWith('books', { page: 1, per_page: 20 }, undefined)
    })

    it('merges filters with pagination', async () => {
      const { service, apiClient } = makeService()
      await service.list('book', { status: 'active' }, { page: 2, perPage: 10 })

      expect(apiClient.get).toHaveBeenCalledWith(
        'books',
        { status: 'active', page: 2, per_page: 10 },
        undefined
      )
    })
  })

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('patches endpoint/recordId with convention payload', async () => {
      const { service, apiClient } = makeService()
      await service.update('book', '123', { title: 'Updated' })

      expect(apiClient.patch).toHaveBeenCalledWith(
        'books/123',
        { book: { title: 'Updated' } },
        undefined
      )
    })

    it('throws ModelReadOnlyError for read-only models', async () => {
      const { service } = makeService()
      await expect(service.update('review', '1', { rating: 3 })).rejects.toThrow(ModelReadOnlyError)
    })
  })

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('deletes at endpoint/recordId', async () => {
      const { service, apiClient } = makeService()
      await service.delete('book', '123')

      expect(apiClient.delete).toHaveBeenCalledWith('books/123', undefined)
    })

    it('throws ModelReadOnlyError for read-only models', async () => {
      const { service } = makeService()
      await expect(service.delete('review', '1')).rejects.toThrow(ModelReadOnlyError)
    })
  })

  // =========================================================================
  // Compound ID support
  // =========================================================================

  describe('compound ID support', () => {
    it('find resolves compound ID as full path', async () => {
      const { service, apiClient } = makeService()
      await service.find('book', 'authors/42/books/7')

      expect(apiClient.get).toHaveBeenCalledWith('authors/42/books/7', {}, undefined)
    })

    it('update resolves compound ID as full path', async () => {
      const { service, apiClient } = makeService()
      await service.update('book', 'authors/42/books/7', { title: 'Updated' })

      expect(apiClient.patch).toHaveBeenCalledWith(
        'authors/42/books/7',
        expect.any(Object),
        undefined
      )
    })

    it('delete resolves compound ID as full path', async () => {
      const { service, apiClient } = makeService()
      await service.delete('book', 'authors/42/books/7')

      expect(apiClient.delete).toHaveBeenCalledWith('authors/42/books/7', undefined)
    })

    it('list uses parentPath for nested collection', async () => {
      const { service, apiClient } = makeService()
      await service.list('book', undefined, undefined, { parentPath: 'authors/42/books' })

      expect(apiClient.get).toHaveBeenCalledWith(
        'authors/42/books',
        { page: 1, per_page: 20 },
        { parentPath: 'authors/42/books' }
      )
    })

    it('list enriches MissingParentError with concrete parent endpoint path', async () => {
      const { service } = makeService()
      await expect(service.list('scheduling')).rejects.toThrow(/books\/\{id\}\/schedulings/)
    })
  })

  // =========================================================================
  // Namespace integration
  // =========================================================================

  describe('namespace support', () => {
    it('applies server-wide namespace to all operations', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: makeModels(),
        namespace: 'api/v1'
      })

      await service.list('book')
      expect(apiClient.get).toHaveBeenCalledWith('api/v1/books', expect.any(Object), undefined)

      await service.find('book', '1')
      expect(apiClient.get).toHaveBeenCalledWith('api/v1/books/1', {}, undefined)

      await service.create('book', { title: 'T', author: 'A' })
      expect(apiClient.post).toHaveBeenCalledWith('api/v1/books', expect.any(Object), undefined)
    })
  })

  // =========================================================================
  // Error types
  // =========================================================================

  describe('error types', () => {
    it('MissingRequiredFieldsError exposes missingFields', async () => {
      const { service } = makeService()
      try {
        await service.create('book', {})
      } catch (e) {
        expect(e).toBeInstanceOf(MissingRequiredFieldsError)
        expect((e as MissingRequiredFieldsError).missingFields).toEqual(['title', 'author'])
      }
    })

    it('UnknownModelError exposes availableModels', async () => {
      const { service } = makeService()
      try {
        await service.find('nonexistent', '1')
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownModelError)
        expect((e as UnknownModelError).availableModels).toContain('book')
      }
    })
  })

  // =========================================================================
  // Endpoint overrides (per-action)
  // =========================================================================

  describe('endpoint overrides', () => {
    it('uses collection override for list', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: {
          book: {
            api: { endpoint: 'books', endpoints: { collection: 'catalogue/book-items' } }
          }
        }
      })

      await service.list('book')
      expect(apiClient.get).toHaveBeenCalledWith(
        'catalogue/book-items',
        expect.any(Object),
        undefined
      )
    })

    it('uses per-action create override', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: {
          book: {
            api: { endpoint: 'books', endpoints: { create: 'books/draft' } }
          }
        }
      })

      await service.create('book', {})
      expect(apiClient.post).toHaveBeenCalledWith('books/draft', expect.any(Object), undefined)
    })

    it('uses record override with :id substitution for find', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: {
          book: {
            api: { endpoint: 'books', endpoints: { record: 'catalogue/book-items/:id' } }
          }
        }
      })

      await service.find('book', '456')
      expect(apiClient.get).toHaveBeenCalledWith('catalogue/book-items/456', {}, undefined)
    })

    it('uses per-action update override with :id substitution', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: {
          book: {
            api: { endpoint: 'books', endpoints: { update: 'books/:id/revise' } }
          }
        }
      })

      await service.update('book', '789', { title: 'Updated' })
      expect(apiClient.patch).toHaveBeenCalledWith(
        'books/789/revise',
        expect.any(Object),
        undefined
      )
    })

    it('uses per-action delete override', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: {
          book: {
            api: { endpoint: 'books', endpoints: { delete: 'books/:id/archive' } }
          }
        }
      })

      await service.delete('book', '10')
      expect(apiClient.delete).toHaveBeenCalledWith('books/10/archive', undefined)
    })
  })

  // =========================================================================
  // Per-model namespace override
  // =========================================================================

  describe('per-model namespace override', () => {
    it('model namespace overrides server-wide namespace', async () => {
      const apiClient = makeApiClient()
      const service = new ModelService({
        apiClient,
        models: {
          book: {
            api: { endpoint: 'books', namespace: 'api/v2' }
          },
          author: {
            api: { endpoint: 'authors' }
          }
        },
        namespace: 'api/v1'
      })

      await service.list('book')
      expect(apiClient.get).toHaveBeenCalledWith('api/v2/books', expect.any(Object), undefined)

      await service.list('author')
      expect(apiClient.get).toHaveBeenCalledWith('api/v1/authors', expect.any(Object), undefined)
    })
  })

  // =========================================================================
  // Accessors
  // =========================================================================

  describe('accessors', () => {
    it('exposes endpointResolver', () => {
      const { service } = makeService()
      expect(service.endpointResolver).toBeDefined()
    })

    it('exposes apiClient', () => {
      const { service, apiClient } = makeService()
      expect(service.apiClient).toBe(apiClient)
    })
  })
})
