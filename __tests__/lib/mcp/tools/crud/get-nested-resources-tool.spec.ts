import { GetNestedResourcesTool } from '../../../../../src/mcp/tools/crud/get-nested-resources-tool.js'

vi.mock('#src/core/helpers.js', async () => {
  const actual = await vi.importActual('#src/core/helpers.js')
  return {
    sanitizeResponseData: vi.fn((data) => JSON.stringify(data, null, 2)),
    pickFields: actual.pickFields
  }
})

vi.mock('#src/services/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('../../../../../src/mcp/tools/validators.js', () => ({
  validateNestedResource: vi.fn()
}))

const { validateNestedResource } = await import('../../../../../src/mcp/tools/validators.js')

describe('lib/mcp/tools/crud/get-nested-resources-tool', () => {
  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new GetNestedResourcesTool({})
      expect(tool.name).toBe('get_nested_resources')
    })

    it('should have correct base description', () => {
      const tool = new GetNestedResourcesTool({})
      expect(tool.baseDescription).toContain('Get nested resources')
    })

    it('should include serverContext scope in description', () => {
      const tool = new GetNestedResourcesTool({
        serverContext: { name: 'Engineer' }
      })
      expect(tool.baseDescription).toContain('Engineer')
    })

    it('should have parent_model, parent_id, child_resource as required in inputSchema', () => {
      const tool = new GetNestedResourcesTool({
        models: { book: { endpoint: 'books' } }
      })
      const schema = tool.inputSchema

      expect(schema.parent_model).toBeDefined()
      expect(schema.parent_id).toBeDefined()
      expect(schema.child_resource).toBeDefined()
      expect(schema.parent_model.isOptional()).toBe(false)
      expect(schema.parent_id.isOptional()).toBe(false)
      expect(schema.child_resource.isOptional()).toBe(false)
    })

    it('should have page, per_page, expand as optional in inputSchema', () => {
      const tool = new GetNestedResourcesTool({})
      const schema = tool.inputSchema

      expect(schema.page).toBeDefined()
      expect(schema.per_page).toBeDefined()
      expect(schema.expand).toBeDefined()
      expect(schema.page.isOptional()).toBe(true)
      expect(schema.per_page.isOptional()).toBe(true)
      expect(schema.expand.isOptional()).toBe(true)
    })
  })

  describe('execute', () => {
    let mockApiClient
    let mockLogger
    let mockModels

    beforeEach(() => {
      mockApiClient = {
        get: vi.fn().mockResolvedValue({ data: [{ id: 1 }] })
      }
      mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
      mockModels = {
        activity: {
          endpoint: 'activities',
          associations: {
            hasMany: {
              books: {
                target_model: 'book',
                expandable: true,
                description: 'Books in this activity'
              }
            }
          }
        },
        book: {
          endpoint: 'books',
          associations: {
            belongsTo: {
              activity: {
                target_model: 'activity',
                auto_expand: true
              }
            }
          }
        }
      }
      validateNestedResource.mockReset()
    })

    it('should require API client', async () => {
      const tool = new GetNestedResourcesTool({ models: mockModels })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_id: '1',
        child_resource: 'books'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })

    it('should validate model name', async () => {
      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: { activity: { endpoint: 'activities' } }
      })

      const result = await tool.execute({
        parent_model: 'unknown_model',
        parent_id: '1',
        child_resource: 'books'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error when nested resource validation fails', async () => {
      validateNestedResource.mockReturnValue({
        valid: false,
        error: "'widgets' is not a valid nested resource for activity",
        availableLinks: ['books', 'categories'],
        suggestion: 'Available nested resources: books, categories'
      })

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_id: '1',
        child_resource: 'widgets'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'widgets' is not a valid nested resource")
      expect(result.content[0].text).toContain('Available nested resources: books, categories')
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Nested resource validation failed',
        expect.objectContaining({
          parentModel: 'activity',
          childResource: 'widgets'
        })
      )
    })

    it('should fetch nested resources with correct endpoint', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: null
      })

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/42/books', {})
    })

    it('should pass page and per_page params', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: null
      })

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books',
        page: 2,
        per_page: 10
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/42/books', {
        page: 2,
        per_page: 10
      })
    })

    it('should use explicit expand param', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: {
          target_model: 'book',
          expandable: true,
          description: 'Books in this activity'
        },
        type: 'hasMany'
      })

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books',
        expand: 'author,category'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/42/books', {
        expand: 'author,category'
      })
    })

    it('should auto-expand from target model belongsTo associations with auto_expand flag', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: {
          target_model: 'book',
          expandable: true,
          description: 'Books in this activity'
        },
        type: 'hasMany'
      })

      const modelsWithAutoExpand = {
        ...mockModels,
        book: {
          endpoint: 'books',
          associations: {
            belongsTo: {
              activity: { target_model: 'activity', auto_expand: true },
              author: { target_model: 'author', auto_expand: false }
            }
          }
        }
      }

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: modelsWithAutoExpand,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/42/books', {
        expand: 'activity'
      })
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Auto-expanding associations from model metadata',
        expect.objectContaining({
          targetModel: 'book',
          autoExpand: 'activity'
        })
      )
    })

    it('should auto-expand from target model hasMany associations with auto_expand flag', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: {
          target_model: 'book',
          expandable: true,
          description: 'Books in this activity'
        },
        type: 'hasMany'
      })

      const modelsWithHasManyAutoExpand = {
        ...mockModels,
        book: {
          endpoint: 'books',
          associations: {
            hasMany: {
              tags: { target_model: 'tag', auto_expand: true },
              reviews: { target_model: 'review', auto_expand: false }
            }
          }
        }
      }

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: modelsWithHasManyAutoExpand,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/42/books', {
        expand: 'tags'
      })
    })

    it('should not include link metadata in response', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: {
          target_model: 'book',
          expandable: true,
          description: 'Books in this activity',
          conditional: 'Only active books'
        },
        type: 'hasMany'
      })

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books'
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text
      expect(text).not.toContain('Link Metadata:')
      expect(text).not.toContain('"link_type"')
    })

    it('should filter response fields when fields param is provided', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: null
      })

      mockApiClient.get.mockResolvedValue([
        { id: 1, name: 'Book A', status: 'active', description: 'Long text' },
        { id: 2, name: 'Book B', status: 'draft', description: 'More text' }
      ])

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books',
        fields: ['name', 'status']
      })

      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toEqual([
        { id: 1, name: 'Book A', status: 'active' },
        { id: 2, name: 'Book B', status: 'draft' }
      ])
    })

    it('should use custom path from linkInfo', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: {
          target_model: 'widget',
          path: 'custom_books',
          expandable: false,
          description: 'Custom path books'
        },
        type: 'hasMany'
      })

      // Use models without auto-expand associations on target
      const simpleModels = {
        activity: { endpoint: 'activities' }
      }

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: simpleModels
      })

      await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/42/custom_books', {})
    })

    it('should handle API errors', async () => {
      validateNestedResource.mockReturnValue({
        valid: true,
        linkInfo: null
      })

      const error = new Error('API Error')
      error.response = { status: 500, data: { error: 'Internal Server Error' } }
      mockApiClient.get.mockRejectedValue(error)

      const tool = new GetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_id: '42',
        child_resource: 'books'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Internal Server Error')
    })
  })
})
