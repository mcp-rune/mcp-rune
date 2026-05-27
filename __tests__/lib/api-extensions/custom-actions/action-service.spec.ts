/**
 * Service-layer tests for the `custom-actions` ApiExtension.
 *
 * Builds a real `ModelService`, applies the mixin contributed by
 * `customActionsExtension()`, and exercises `service.action()` end-to-end
 * through the convention pipeline and `dispatch()` helper.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ActionServiceMethods } from '../../../../src/api-extensions/custom-actions.js'
import {
  customActionsConfig,
  customActionsExtension,
  UnknownActionError
} from '../../../../src/api-extensions/custom-actions.js'
import type { ApiClient } from '../../../../src/core/api-client.js'
import { jsonApiConvention } from '../../../../src/mcp/api-conventions/index.js'
import type { ModelServiceMixin } from '../../../../src/mcp/api-extensions/types.js'
import { ModelService, UnknownModelError } from '../../../../src/mcp/services/model-service.js'
import type { ModelConfig } from '../../../../src/mcp/tools/base-tool.js'

function captureActionMixin(): ModelServiceMixin {
  let captured: ModelServiceMixin | undefined
  customActionsExtension().register({
    name: 'custom-actions',
    models: {},
    serverContext: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    registerTool: () => {},
    registerModelServiceMixin: (m) => {
      captured = m
    }
  })
  return captured!
}
const actionMixin = captureActionMixin()

describe('api-extensions/custom-actions — action() mixin on ModelService', () => {
  function makeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
    return {
      baseUrl: 'https://api.example.com',
      get: vi.fn().mockResolvedValue({ id: '1' }),
      post: vi.fn().mockResolvedValue({ id: '1', status: 'published' }),
      put: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({ id: '1', status: 'archived' }),
      delete: vi.fn().mockResolvedValue({}),
      ...overrides
    }
  }

  function makeModels(): Record<string, ModelConfig> {
    return {
      book_with_actions: {
        attributes: { title: { type: 'string' } },
        description: 'Book with custom actions',
        api: { endpoint: 'books', convention: jsonApiConvention },
        extensions: {
          'custom-actions': customActionsConfig({
            actions: {
              publish: { path: ':id/publish', description: 'Publish a book' },
              archive: { path: ':id/archive', method: 'PATCH' },
              export: { path: ':id/export', method: 'GET' },
              bulk_publish: { path: 'bulk-publish', recordLevel: false, rawPayload: true },
              approve_chapter: { path: ':id/chapters/:chapter_id/approve' }
            }
          })
        }
      }
    }
  }

  function makeService(modelsOverride?: Record<string, ModelConfig>) {
    const apiClient = makeApiClient()
    const service = new ModelService({
      apiClient,
      models: modelsOverride ?? makeModels()
    })
    Object.assign(service, actionMixin(service))
    return { service: service as ModelService & ActionServiceMethods, apiClient }
  }

  it('dispatches POST by default', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'publish', { recordId: '42' })
    expect(apiClient.post).toHaveBeenCalledWith('books/42/publish', undefined)
  })

  it('dispatches to correct HTTP method (PATCH)', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'archive', {
      recordId: '42',
      attributes: { reason: 'outdated' }
    })
    expect(apiClient.patch).toHaveBeenCalledWith('books/42/archive', {
      book_with_actions: { reason: 'outdated' }
    })
  })

  it('dispatches GET with query params', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'export', {
      recordId: '42',
      params: { format: 'pdf' }
    })
    expect(apiClient.get).toHaveBeenCalledWith('books/42/export', { format: 'pdf' })
  })

  it('wraps attributes via convention by default', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'archive', {
      recordId: '42',
      attributes: { reason: 'outdated' }
    })
    const call = (apiClient.patch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1]).toHaveProperty('book_with_actions')
  })

  it('sends raw payload when rawPayload is true', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'bulk_publish', {
      attributes: { ids: [1, 2, 3] }
    })
    expect(apiClient.post).toHaveBeenCalledWith('books/bulk-publish', { ids: [1, 2, 3] })
  })

  it('passes request options (userId) through', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'publish', {
      recordId: '42',
      requestOptions: { userId: 'u1' }
    })
    expect(apiClient.post).toHaveBeenCalledWith('books/42/publish', undefined, { userId: 'u1' })
  })

  it('passes pathParams for multi-param substitution', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'approve_chapter', {
      recordId: '42',
      pathParams: { chapter_id: '5' }
    })
    expect(apiClient.post).toHaveBeenCalledWith('books/42/chapters/5/approve', undefined)
  })

  it('resolves compound IDs correctly', async () => {
    const { service, apiClient } = makeService()
    await service.action('book_with_actions', 'publish', {
      recordId: 'authors/10/books/42'
    })
    expect(apiClient.post).toHaveBeenCalledWith('authors/10/books/42/publish', undefined)
  })

  it('throws UnknownModelError for bad model', async () => {
    const { service } = makeService()
    await expect(service.action('nonexistent', 'publish', { recordId: '1' })).rejects.toThrow(
      UnknownModelError
    )
  })

  it('throws UnknownActionError for bad action', async () => {
    const { service } = makeService()
    await expect(
      service.action('book_with_actions', 'nonexistent', { recordId: '1' })
    ).rejects.toThrow(UnknownActionError)
  })

  it('does NOT enforce readOnly guard (read-only models can still have actions)', async () => {
    const models = makeModels()
    models.readonly_book = {
      api: { endpoint: 'books', readOnly: true },
      extensions: {
        'custom-actions': customActionsConfig({
          actions: { export: { path: ':id/export', method: 'GET' } }
        })
      }
    }
    const { service, apiClient } = makeService(models)
    await service.action('readonly_book', 'export', { recordId: '1' })
    expect(apiClient.get).toHaveBeenCalledWith('books/1/export', undefined)
  })
})
