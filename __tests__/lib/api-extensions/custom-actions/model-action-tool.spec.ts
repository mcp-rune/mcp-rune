import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  customActionsConfig,
  customActionsExtension,
  ModelActionTool
} from '../../../../src/api-extensions/custom-actions.js'
import type { ApiClient } from '../../../../src/core/api-client.js'
import type { ModelServiceMixin } from '../../../../src/mcp/api-extensions/types.js'
import { ModelService } from '../../../../src/mcp/services/model-service.js'

/**
 * Captures the mixin contributed by `customActionsExtension()` by invoking
 * the real extension factory against a stub context. This exercises the
 * public extension surface — no internal helper export needed.
 */
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

describe('api-extensions/custom-actions — ModelActionTool', () => {
  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new ModelActionTool({})
      expect(tool.name).toBe('model_action')
    })

    it('should have correct base description', () => {
      const tool = new ModelActionTool({})
      expect(tool.baseDescription).toContain('custom action')
    })

    it('should include serverContext scope in description', () => {
      const tool = new ModelActionTool({
        serverContext: { name: 'Test App' }
      })
      expect(tool.baseDescription).toContain('Test App')
    })

    it('should have model, action, record_id, attributes, path_params, params in inputSchema', () => {
      const tool = new ModelActionTool({})
      const schema = tool.inputSchema
      expect(schema.model).toBeDefined()
      expect(schema.action).toBeDefined()
      expect(schema.record_id).toBeDefined()
      expect(schema.attributes).toBeDefined()
      expect(schema.path_params).toBeDefined()
      expect(schema.params).toBeDefined()
      expect(schema.user_id).toBeDefined()
    })

    it('should only include models with actions in model enum', () => {
      const mockModels = {
        book: {
          api: { endpoint: 'books' },
          extensions: {
            'custom-actions': customActionsConfig({
              actions: { publish: { path: ':id/publish' } }
            })
          }
        },
        review: { api: { endpoint: 'reviews' } },
        report: {
          api: { endpoint: 'reports' },
          extensions: {
            'custom-actions': customActionsConfig({
              actions: { export: { path: ':id/export', method: 'GET' } }
            })
          }
        }
      }

      const tool = new ModelActionTool({ models: mockModels })
      const modelSchema = tool.inputSchema.model as unknown as { options: string[] }
      expect(modelSchema.options).toContain('book')
      expect(modelSchema.options).toContain('report')
      expect(modelSchema.options).not.toContain('review')
    })

    it('should include action summary in description', () => {
      const mockModels = {
        book: {
          api: { endpoint: 'books' },
          extensions: {
            'custom-actions': customActionsConfig({
              actions: {
                publish: { path: ':id/publish', description: 'Publish a book' },
                archive: { path: ':id/archive', method: 'PATCH' }
              }
            })
          }
        }
      }

      const tool = new ModelActionTool({ models: mockModels })
      expect(tool.baseDescription).toContain('publish')
      expect(tool.baseDescription).toContain('Publish a book')
      expect(tool.baseDescription).toContain('archive')
      expect(tool.baseDescription).toContain('PATCH')
    })

    it('should show no action summary when no models have actions', () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const tool = new ModelActionTool({ models: mockModels })
      expect(tool.baseDescription).not.toContain('Available actions')
    })
  })

  describe('execute', () => {
    let mockApiClient: {
      baseUrl: string
      get: ReturnType<typeof vi.fn>
      post: ReturnType<typeof vi.fn>
      put: ReturnType<typeof vi.fn>
      patch: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }
    let mockLogger: {
      info: ReturnType<typeof vi.fn>
      warn: ReturnType<typeof vi.fn>
      error: ReturnType<typeof vi.fn>
      debug: ReturnType<typeof vi.fn>
    }

    const mockModels = {
      book: {
        api: { endpoint: 'books' },
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

    function makeTool(deps: { apiClient?: unknown; logger?: unknown } = {}): ModelActionTool {
      const apiClient = (deps.apiClient ?? mockApiClient) as ApiClient
      const service = new ModelService({ apiClient, models: mockModels })
      Object.assign(service, actionMixin(service))
      return new ModelActionTool({
        dataLayer: service,
        models: mockModels,
        logger: deps.logger as never
      })
    }

    beforeEach(() => {
      mockApiClient = {
        baseUrl: 'https://api.test',
        get: vi.fn().mockResolvedValue({ id: '1', status: 'exported' }),
        post: vi.fn().mockResolvedValue({ id: '1', status: 'published' }),
        put: vi.fn().mockResolvedValue({}),
        patch: vi.fn().mockResolvedValue({ id: '1', status: 'archived' }),
        delete: vi.fn().mockResolvedValue({})
      }
      mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
    })

    it('should execute a simple action successfully', async () => {
      const tool = makeTool({ logger: mockLogger })

      const result = await tool.execute({
        model: 'book',
        action: 'publish',
        record_id: '42'
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('books/42/publish')
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('success')
    })

    it('should pass path_params through', async () => {
      const tool = makeTool({ logger: mockLogger })

      await tool.execute({
        model: 'book',
        action: 'approve_chapter',
        record_id: '42',
        path_params: { chapter_id: '5' }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('books/42/chapters/5/approve')
    })

    it('should pass query params for GET actions', async () => {
      const tool = makeTool({ logger: mockLogger })

      await tool.execute({
        model: 'book',
        action: 'export',
        record_id: '42',
        params: { format: 'pdf' }
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('books/42/export', { format: 'pdf' })
    })

    it('should pass user_id as requestOptions', async () => {
      const tool = makeTool({ logger: mockLogger })

      await tool.execute({
        model: 'book',
        action: 'publish',
        record_id: '42',
        user_id: '99'
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('books/42/publish', undefined, {
        userId: '99'
      })
    })

    it('should return error for unknown model', async () => {
      const tool = makeTool({ logger: mockLogger })

      const result = await tool.execute({
        model: 'unknown_model',
        action: 'publish',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error for unknown action', async () => {
      const tool = makeTool({ logger: mockLogger })

      const result = await tool.execute({
        model: 'book',
        action: 'nonexistent',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown action')
    })

    it('should require API client', async () => {
      const tool = new ModelActionTool({ models: mockModels })

      const result = await tool.execute({
        model: 'book',
        action: 'publish',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should handle API errors', async () => {
      const error = new Error('Server Error') as Error & {
        response?: { status?: number; data?: unknown }
      }
      error.response = { status: 500, data: { error: 'Internal error' } }
      mockApiClient.post.mockRejectedValue(error)

      const tool = makeTool()

      const result = await tool.execute({
        model: 'book',
        action: 'publish',
        record_id: '42'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Internal error')
    })
  })
})
