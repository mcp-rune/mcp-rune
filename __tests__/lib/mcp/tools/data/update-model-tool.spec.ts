import { UpdateModelTool } from '../../../../../src/mcp/tools/data/update-model-tool.js'
import { flatConvention } from '../../../../__fixtures__/flat-convention.js'

vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn().mockResolvedValue(null)
}))
import { ModelService } from '#src/mcp/services/model-service.js'

const { storeOperation } = await import('#src/services/vector-storage.js')

describe('lib/mcp/tools/data/update-model-tool', () => {
  describe('description composition', () => {
    it('should include serverContext scope in description', () => {
      const tool = new UpdateModelTool({
        serverContext: { name: 'Test App' }
      })
      expect(tool.baseDescription).toContain('Test App')
    })
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new UpdateModelTool({})
      expect(tool.name).toBe('update_model')
    })

    it('should have correct base description', () => {
      const tool = new UpdateModelTool({})
      expect(tool.baseDescription).toContain('Update a single existing record')
    })

    it('should have model, record_id and attributes in inputSchema', () => {
      const tool = new UpdateModelTool({})
      const schema = tool.inputSchema
      expect(schema.model).toBeDefined()
      expect(schema.record_id).toBeDefined()
      expect(schema.attributes).toBeDefined()
      expect(schema.model.isOptional()).toBe(false)
      expect(schema.record_id.isOptional()).toBe(false)
      expect(schema.attributes.isOptional()).toBe(false)
    })

    it('should include user_id in inputSchema', () => {
      const tool = new UpdateModelTool({})
      expect(tool.inputSchema.user_id).toBeDefined()
    })

    it('should include model enum from models config', () => {
      const mockModels = {
        activity: { api: { endpoint: 'activities' } },
        book: { api: { endpoint: 'books' } }
      }

      const tool = new UpdateModelTool({ models: mockModels })
      const modelSchema = tool.inputSchema.model
      expect(modelSchema.options).toContain('activity')
      expect(modelSchema.options).toContain('book')
    })
  })

  describe('execute', () => {
    let mockApiClient
    let mockLogger

    beforeEach(() => {
      mockApiClient = {
        patch: vi.fn()
      }
      mockLogger = {
        info: vi.fn()
      }
    })

    it('should update a record successfully with Rails payload wrapping', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities' }
        }
      }

      mockApiClient.patch.mockResolvedValue({ id: 1, title: 'Updated Session' })

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        record_id: '1',
        attributes: { title: 'Updated Session' }
      })

      expect(mockApiClient.patch).toHaveBeenCalledWith('activities/1', {
        activity: { title: 'Updated Session' }
      })
      expect(result.isError).toBeFalsy()
    })

    it('should return error when record_id is missing', async () => {
      const mockModels = {
        activity: { api: { endpoint: 'activities' } }
      }

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Updated' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('record_id is required')
    })

    it('should return error for unknown model', async () => {
      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: { book: { api: { endpoint: 'books' } } }
        }),
        models: { book: { api: { endpoint: 'books' } } }
      })

      const result = await tool.execute({
        model: 'unknown_model',
        record_id: '1',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should require API client', async () => {
      const tool = new UpdateModelTool({ models: {} })

      const result = await tool.execute({
        model: 'activity',
        record_id: '1',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should handle API errors', async () => {
      const mockModels = {
        activity: { api: { endpoint: 'activities' } }
      }

      const error = new Error('API Error')
      error.response = { status: 404, data: { error: 'Record not found' } }
      mockApiClient.patch.mockRejectedValue(error)

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        record_id: '999',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Record not found')
    })

    it('should log update when logger is available', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated Book' })

      const tool = new UpdateModelTool({
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
        record_id: '5',
        attributes: { title: 'Updated Book' }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Updating model',
        expect.objectContaining({ model: 'book', recordId: '5' })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Model updated successfully',
        expect.objectContaining({ model: 'book', recordId: '5' })
      )
    })

    it('should support user_id impersonation', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated' })

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      await tool.execute({
        model: 'book',
        record_id: '5',
        attributes: { title: 'Updated' },
        user_id: '42'
      })

      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'books/5',
        { book: { title: 'Updated' } },
        { userId: '42' }
      )
    })

    it('should call storeOperation after successful update', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated Book' })
      storeOperation.mockClear()

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        serverContext: { sessionId: 'sess-456' }
      })

      await tool.execute({
        model: 'book',
        record_id: '5',
        attributes: { title: 'Updated Book' }
      })

      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'update_model',
        toolArgs: { model: 'book', id: '5', attributes: { title: 'Updated Book' } },
        toolOutput: { id: 5, title: 'Updated Book' },
        userId: undefined,
        sessionId: 'sess-456'
      })
    })

    it('should not fail if storeOperation rejects', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books' } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated' })
      storeOperation.mockRejectedValueOnce(new Error('pgvector unavailable'))

      const mockWarnLogger = { info: vi.fn(), warn: vi.fn() }

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockWarnLogger
      })

      const result = await tool.execute({
        model: 'book',
        record_id: '5',
        attributes: { title: 'Updated' }
      })

      // Should still succeed — storeOperation failure is swallowed
      expect(result.isError).toBeFalsy()
    })
  })

  // ─── FLAT PAYLOAD via flat convention ─────────────────────────────────────────

  describe('execute — flat payload via flat convention', () => {
    let mockApiClient
    let mockLogger

    beforeEach(() => {
      mockApiClient = {
        patch: vi.fn()
      }
      mockLogger = {
        info: vi.fn()
      }
    })

    it('should update a record successfully with flat payload', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities', convention: flatConvention }
        }
      }

      mockApiClient.patch.mockResolvedValue({ id: 1, title: 'Updated Session' })

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        record_id: '1',
        attributes: { title: 'Updated Session' }
      })

      expect(mockApiClient.patch).toHaveBeenCalledWith('activities/1', {
        title: 'Updated Session'
      })
      expect(result.isError).toBeFalsy()
    })

    it('should return error when record_id is missing', async () => {
      const mockModels = {
        activity: { api: { endpoint: 'activities', convention: flatConvention } }
      }

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Updated' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('record_id is required')
    })

    it('should return error for unknown model', async () => {
      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: { book: { api: { endpoint: 'books', convention: flatConvention } } }
        }),
        models: { book: { api: { endpoint: 'books', convention: flatConvention } } }
      })

      const result = await tool.execute({
        model: 'unknown_model',
        record_id: '1',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should require API client', async () => {
      const tool = new UpdateModelTool({
        models: {}
      })

      const result = await tool.execute({
        model: 'activity',
        record_id: '1',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should handle API errors', async () => {
      const mockModels = {
        activity: { api: { endpoint: 'activities', convention: flatConvention } }
      }

      const error = new Error('API Error')
      error.response = { status: 404, data: { error: 'Record not found' } }
      mockApiClient.patch.mockRejectedValue(error)

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        record_id: '999',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Record not found')
    })

    it('should log update when logger is available', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books', convention: flatConvention } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated Book' })

      const tool = new UpdateModelTool({
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
        record_id: '5',
        attributes: { title: 'Updated Book' }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Updating model',
        expect.objectContaining({ model: 'book', recordId: '5' })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Model updated successfully',
        expect.objectContaining({ model: 'book', recordId: '5' })
      )
    })

    it('should support user_id impersonation with flat payload', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books', convention: flatConvention } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated' })

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels
      })

      await tool.execute({
        model: 'book',
        record_id: '5',
        attributes: { title: 'Updated' },
        user_id: '42'
      })

      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'books/5',
        { title: 'Updated' },
        { userId: '42' }
      )
    })

    it('should call storeOperation after successful update', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books', convention: flatConvention } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated Book' })
      storeOperation.mockClear()

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        serverContext: { sessionId: 'sess-456' }
      })

      await tool.execute({
        model: 'book',
        record_id: '5',
        attributes: { title: 'Updated Book' }
      })

      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'update_model',
        toolArgs: { model: 'book', id: '5', attributes: { title: 'Updated Book' } },
        toolOutput: { id: 5, title: 'Updated Book' },
        userId: undefined,
        sessionId: 'sess-456'
      })
    })

    it('should not fail if storeOperation rejects', async () => {
      const mockModels = {
        book: { api: { endpoint: 'books', convention: flatConvention } }
      }

      mockApiClient.patch.mockResolvedValue({ id: 5, title: 'Updated' })
      storeOperation.mockRejectedValueOnce(new Error('pgvector unavailable'))

      const mockWarnLogger = { info: vi.fn(), warn: vi.fn() }

      const tool = new UpdateModelTool({
        dataLayer: new ModelService({
          apiClient: mockApiClient,
          models: mockModels,
          logger: mockLogger
        }),
        models: mockModels,
        logger: mockWarnLogger
      })

      const result = await tool.execute({
        model: 'book',
        record_id: '5',
        attributes: { title: 'Updated' }
      })

      // Should still succeed — storeOperation failure is swallowed
      expect(result.isError).toBeFalsy()
    })
  })
})
