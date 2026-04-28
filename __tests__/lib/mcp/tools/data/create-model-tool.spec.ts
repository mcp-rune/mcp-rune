import { CreateModelTool } from '../../../../../src/mcp/tools/data/create-model-tool.js'
import { flatConvention } from '../../../../__fixtures__/flat-convention.js'

vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn().mockResolvedValue(null)
}))

const { storeOperation } = await import('#src/services/vector-storage.js')

describe('lib/mcp/tools/data/create-model-tool', () => {
  describe('description composition', () => {
    it('should include serverContext scope in description', () => {
      const tool = new CreateModelTool({
        serverContext: { name: 'Test App' }
      })
      expect(tool.baseDescription).toContain('Test App')
    })
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new CreateModelTool({})
      expect(tool.name).toBe('create_model')
    })

    it('should have correct base description', () => {
      const tool = new CreateModelTool({})
      expect(tool.baseDescription).toContain('Create a single record')
    })

    it('should have model and attributes in inputSchema', () => {
      const tool = new CreateModelTool({})
      const schema = tool.inputSchema
      expect(schema.model).toBeDefined()
      expect(schema.attributes).toBeDefined()
      expect(schema.model.isOptional()).toBe(false)
      expect(schema.attributes.isOptional()).toBe(false)
    })

    it('should include user_id in inputSchema', () => {
      const tool = new CreateModelTool({})
      expect(tool.inputSchema.user_id).toBeDefined()
    })

    it('should include model enum from models config', () => {
      const mockModels = {
        activity: { api: { endpoint: 'activities' } },
        book: { api: { endpoint: 'books' } }
      }

      const tool = new CreateModelTool({ models: mockModels })
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
        post: vi.fn()
      }
      mockLogger = {
        info: vi.fn()
      }
    })

    it('should create a record successfully with Rails payload wrapping', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities' },
          required: ['title']
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 1, title: 'New Session' })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'New Session' }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'activities',
        {
          activity: { title: 'New Session' }
        },
        undefined
      )
      expect(result.isError).toBeFalsy()
    })

    it('should return error for missing required fields', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities' },
          required: ['title', 'duration']
        }
      }

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Session' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Missing required fields')
      expect(result.content[0].text).toContain('duration')
    })

    it('should return error for unknown model', async () => {
      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: { book: { api: { endpoint: 'books' } } }
      })

      const result = await tool.execute({
        model: 'unknown_model',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should require API client', async () => {
      const tool = new CreateModelTool({ models: {} })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should handle API errors', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities' },
          required: ['title']
        }
      }

      const error = new Error('API Error')
      error.response = { status: 422, data: { errors: ['Title is invalid'] } }
      mockApiClient.post.mockRejectedValue(error)

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Title is invalid')
    })

    it('should log creation when logger is available', async () => {
      const mockModels = {
        book: {
          api: { endpoint: 'books' },
          required: ['title']
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 5, title: 'New Book' })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        model: 'book',
        attributes: { title: 'New Book' }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Creating model',
        expect.objectContaining({ model: 'book' })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Model created successfully',
        expect.objectContaining({ model: 'book', id: 5 })
      )
    })

    it('should support user_id impersonation', async () => {
      const mockModels = {
        book: {
          api: { endpoint: 'books' },
          required: ['title']
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 1, title: 'Test' })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        model: 'book',
        attributes: { title: 'Test' },
        user_id: '42'
      })

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'books',
        { book: { title: 'Test' } },
        { userId: '42' }
      )
    })

    it('should call storeOperation after successful creation', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities' },
          required: ['title']
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 42, title: 'New Session' })
      storeOperation.mockClear()

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        serverContext: { sessionId: 'sess-123' }
      })

      await tool.execute({
        model: 'activity',
        attributes: { title: 'New Session' }
      })

      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'create_model',
        toolArgs: { model: 'activity', attributes: { title: 'New Session' } },
        toolOutput: { id: 42, title: 'New Session' },
        userId: undefined,
        sessionId: 'sess-123'
      })
    })

    it('should not fail if storeOperation rejects', async () => {
      const mockModels = {
        activity: {
          api: { endpoint: 'activities' },
          required: ['title']
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 1, title: 'Test' })
      storeOperation.mockRejectedValueOnce(new Error('pgvector unavailable'))

      const mockWarnLogger = { info: vi.fn(), warn: vi.fn() }

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockWarnLogger
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Test' }
      })

      // Should still succeed — storeOperation failure is swallowed
      expect(result.isError).toBeFalsy()
    })
  })

  // ─── COMPACT RESPONSE ────────────────────────────────────────────────────────

  describe('compact response', () => {
    let mockApiClient
    let mockLogger

    beforeEach(() => {
      mockApiClient = { post: vi.fn() }
      mockLogger = { info: vi.fn() }
    })

    it('should return compact response without echoing full API data', async () => {
      const mockModels = {
        brand: {
          api: { endpoint: 'brands' },
          required: ['name']
        }
      }

      mockApiClient.post.mockResolvedValue({
        id: '1',
        name: 'Test',
        description: 'Long text',
        extra_field: 'data'
      })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'brand',
        attributes: { name: 'Test' }
      })

      expect(result.isError).toBeFalsy()

      const data = JSON.parse(result.content[0].text)
      expect(data).toEqual({ status: 'created', model: 'brand', id: '1' })
      expect(result.content[0].text).not.toContain('description')
      expect(result.content[0].text).not.toContain('extra_field')
    })
  })

  // ─── FLAT PAYLOAD via flat convention ─────────────────────────────────────────

  describe('execute — flat payload via flat convention', () => {
    let mockApiClient
    let mockLogger

    beforeEach(() => {
      mockApiClient = {
        post: vi.fn()
      }
      mockLogger = {
        info: vi.fn()
      }
    })

    it('should create a record successfully with flat payload', async () => {
      const mockModels = {
        activity: {
          required: ['title'],
          api: { endpoint: 'activities', convention: flatConvention }
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 1, title: 'New Session' })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'New Session' }
      })

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'activities',
        { title: 'New Session' },
        undefined
      )
      expect(result.isError).toBeFalsy()
    })

    it('should return error for missing required fields', async () => {
      const mockModels = {
        activity: {
          required: ['title', 'duration'],
          api: { endpoint: 'activities', convention: flatConvention }
        }
      }

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Session' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Missing required fields')
      expect(result.content[0].text).toContain('duration')
    })

    it('should return error for unknown model', async () => {
      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: { book: { api: { endpoint: 'books', convention: flatConvention } } }
      })

      const result = await tool.execute({
        model: 'unknown_model',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should require API client', async () => {
      const tool = new CreateModelTool({
        models: {}
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should handle API errors', async () => {
      const mockModels = {
        activity: {
          required: ['title'],
          api: { endpoint: 'activities', convention: flatConvention }
        }
      }

      const error = new Error('API Error')
      error.response = { status: 422, data: { errors: ['Title is invalid'] } }
      mockApiClient.post.mockRejectedValue(error)

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Test' }
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Title is invalid')
    })

    it('should log creation when logger is available', async () => {
      const mockModels = {
        book: {
          required: ['title'],
          api: { endpoint: 'books', convention: flatConvention }
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 5, title: 'New Book' })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        model: 'book',
        attributes: { title: 'New Book' }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Creating model',
        expect.objectContaining({ model: 'book' })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Model created successfully',
        expect.objectContaining({ model: 'book', id: 5 })
      )
    })

    it('should support user_id impersonation with flat payload', async () => {
      const mockModels = {
        book: {
          required: ['title'],
          api: { endpoint: 'books', convention: flatConvention }
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 1, title: 'Test' })

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        model: 'book',
        attributes: { title: 'Test' },
        user_id: '42'
      })

      expect(mockApiClient.post).toHaveBeenCalledWith('books', { title: 'Test' }, { userId: '42' })
    })

    it('should call storeOperation after successful creation', async () => {
      const mockModels = {
        activity: {
          required: ['title'],
          api: { endpoint: 'activities', convention: flatConvention }
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 42, title: 'New Session' })
      storeOperation.mockClear()

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        serverContext: { sessionId: 'sess-123' }
      })

      await tool.execute({
        model: 'activity',
        attributes: { title: 'New Session' }
      })

      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'create_model',
        toolArgs: { model: 'activity', attributes: { title: 'New Session' } },
        toolOutput: { id: 42, title: 'New Session' },
        userId: undefined,
        sessionId: 'sess-123'
      })
    })

    it('should not fail if storeOperation rejects', async () => {
      const mockModels = {
        activity: {
          required: ['title'],
          api: { endpoint: 'activities', convention: flatConvention }
        }
      }

      mockApiClient.post.mockResolvedValue({ id: 1, title: 'Test' })
      storeOperation.mockRejectedValueOnce(new Error('pgvector unavailable'))

      const mockWarnLogger = { info: vi.fn(), warn: vi.fn() }

      const tool = new CreateModelTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockWarnLogger
      })

      const result = await tool.execute({
        model: 'activity',
        attributes: { title: 'Test' }
      })

      // Should still succeed — storeOperation failure is swallowed
      expect(result.isError).toBeFalsy()
    })
  })
})
