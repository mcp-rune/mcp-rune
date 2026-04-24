import { ModelActionTool } from '../../../../../src/mcp/tools/data/model-action-tool.js'

describe('lib/mcp/tools/data/model-action-tool', () => {
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
          api: {
            endpoint: 'books',
            actions: { publish: { path: ':id/publish' } }
          }
        },
        review: { api: { endpoint: 'reviews' } },
        report: {
          api: {
            endpoint: 'reports',
            actions: { export: { path: ':id/export', method: 'GET' } }
          }
        }
      }

      const tool = new ModelActionTool({ models: mockModels })
      const modelSchema = tool.inputSchema.model
      expect(modelSchema.options).toContain('book')
      expect(modelSchema.options).toContain('report')
      expect(modelSchema.options).not.toContain('review')
    })

    it('should include action summary in description', () => {
      const mockModels = {
        book: {
          api: {
            endpoint: 'books',
            actions: {
              publish: { path: ':id/publish', description: 'Publish a book' },
              archive: { path: ':id/archive', method: 'PATCH' }
            }
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
    let mockApiClient
    let mockLogger

    const mockModels = {
      book: {
        api: {
          endpoint: 'books',
          actions: {
            publish: { path: ':id/publish', description: 'Publish a book' },
            archive: { path: ':id/archive', method: 'PATCH' },
            export: { path: ':id/export', method: 'GET' },
            bulk_publish: { path: 'bulk-publish', recordLevel: false, rawPayload: true },
            approve_chapter: { path: ':id/chapters/:chapter_id/approve' }
          }
        }
      }
    }

    beforeEach(() => {
      mockApiClient = {
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
      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'book',
        action: 'publish',
        record_id: '42'
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('books/42/publish', undefined, undefined)
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('success')
    })

    it('should pass path_params through', async () => {
      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        model: 'book',
        action: 'approve_chapter',
        record_id: '42',
        path_params: { chapter_id: '5' }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'books/42/chapters/5/approve',
        undefined,
        undefined
      )
    })

    it('should pass query params for GET actions', async () => {
      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        model: 'book',
        action: 'export',
        record_id: '42',
        params: { format: 'pdf' }
      })

      expect(mockApiClient.get).toHaveBeenCalledWith(
        'books/42/export',
        { format: 'pdf' },
        undefined
      )
    })

    it('should pass user_id as requestOptions', async () => {
      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

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
      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'unknown_model',
        action: 'publish',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error for unknown action', async () => {
      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

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
      const error = new Error('Server Error')
      error.response = { status: 500, data: { error: 'Internal error' } }
      mockApiClient.post.mockRejectedValue(error)

      const tool = new ModelActionTool({
        apiClient: mockApiClient,
        models: mockModels
      })

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
