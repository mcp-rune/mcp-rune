import { DeleteModelTool } from '../../../../../src/mcp/tools/data/delete-model-tool.js'

vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn().mockResolvedValue(null)
}))
import { ModelService } from '#src/mcp/services/model-service.js'

const { storeOperation } = await import('#src/services/vector-storage.js')

describe('lib/mcp/tools/data/delete-model-tool', () => {
  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new DeleteModelTool({})
      expect(tool.name).toBe('delete_model')
    })

    it('should have correct base description', () => {
      const tool = new DeleteModelTool({})
      expect(tool.baseDescription).toContain('Delete a single record')
    })

    it('should have model and record_id in inputSchema', () => {
      const tool = new DeleteModelTool({})
      const schema = tool.inputSchema
      expect(schema.model).toBeDefined()
      expect(schema.record_id).toBeDefined()
      expect(schema.model.isOptional()).toBe(false)
      expect(schema.record_id.isOptional()).toBe(false)
    })

    it('should include user_id in inputSchema', () => {
      const tool = new DeleteModelTool({})
      expect(tool.inputSchema.user_id).toBeDefined()
    })

    it('should include serverContext scope in description', () => {
      const tool = new DeleteModelTool({
        serverContext: { name: 'Test App' }
      })
      expect(tool.baseDescription).toContain('Test App')
    })

    it('should exclude read-only models from enum', () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } },
        report: { api: { endpoint: 'reports', readOnly: true } }
      }

      const tool = new DeleteModelTool({ models: mockModels })
      const modelSchema = tool.inputSchema.model
      expect(modelSchema.options).toContain('book')
      expect(modelSchema.options).not.toContain('report')
    })
  })

  describe('execute', () => {
    let mockApiClient
    let mockLogger

    beforeEach(() => {
      mockApiClient = {
        delete: vi.fn().mockResolvedValue(undefined)
      }
      mockLogger = {
        info: vi.fn(),
        warn: vi.fn()
      }
      storeOperation.mockClear()
    })

    it('should delete a record successfully', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'book',
        record_id: '42'
      })

      expect(mockApiClient.delete).toHaveBeenCalledWith('books/42', undefined)
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('success')
    })

    it('should return error when record_id is missing', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      const result = await tool.execute({
        model: 'book'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('record_id is required')
    })

    it('should return error for unknown model', async () => {
      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: { book: { api: { endpoint: 'books' } } }
        }),
        models: { book: { api: { endpoint: 'books' } } }
      })

      const result = await tool.execute({
        model: 'unknown_model',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error for read-only model', async () => {
      const readOnlyModels = {
        report: {
          api: { endpoint: 'reports', readOnly: true },
          description: 'Read-only reports'
        }
      }
      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: readOnlyModels,
          logger: mockLogger
        }),
        models: readOnlyModels
      })

      const result = await tool.execute({
        model: 'report',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('read-only')
    })

    it('should require API client', async () => {
      const tool = new DeleteModelTool({ models: {} })

      const result = await tool.execute({
        model: 'book',
        record_id: '1'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should handle API errors', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const error = new Error('API Error')
      error.response = { status: 404, data: { error: 'Record not found' } }
      mockApiClient.delete.mockRejectedValue(error)

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      const result = await tool.execute({
        model: 'book',
        record_id: '999'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Record not found')
    })

    it('should log deletion when logger is available', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        model: 'book',
        record_id: '42'
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Deleting model',
        expect.objectContaining({ model: 'book', recordId: '42' })
      )
    })

    it('should support user_id impersonation', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      await tool.execute({
        model: 'book',
        record_id: '42',
        user_id: '99'
      })

      expect(mockApiClient.delete).toHaveBeenCalledWith('books/42', { userId: '99' })
    })

    it('should call storeOperation after successful deletion', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        serverContext: { sessionId: 'sess-789' }
      })

      await tool.execute({
        model: 'book',
        record_id: '42'
      })

      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'delete_model',
        toolArgs: { model: 'book', id: '42' },
        userId: undefined,
        sessionId: 'sess-789'
      })
    })

    it('should not fail if storeOperation rejects', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      storeOperation.mockRejectedValueOnce(new Error('pgvector unavailable'))

      const tool = new DeleteModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'book',
        record_id: '42'
      })

      // Should still succeed — storeOperation failure is swallowed
      expect(result.isError).toBeFalsy()
    })
  })
})
