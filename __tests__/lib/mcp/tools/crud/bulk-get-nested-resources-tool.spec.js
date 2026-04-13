import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
  BulkGetNestedResourcesTool,
  MAX_BATCH_SIZE
} from '../../../../../src/mcp/tools/crud/bulk-get-nested-resources-tool.js'

describe('lib/mcp/tools/crud/bulk-get-nested-resources-tool', () => {
  const mockModels = {
    activity: {
      endpoint: 'activities',
      associations: {
        hasMany: {
          books: {
            path: 'books',
            target_model: 'book',
            expandable: true,
            description: 'Books in this activity'
          },
          categories: {
            path: 'categories',
            target_model: 'category',
            expandable: false
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
        },
        hasMany: {}
      }
    },
    category: {
      endpoint: 'categories'
    }
  }

  let mockApiClient
  let mockLogger

  beforeEach(() => {
    mockApiClient = {
      get: vi.fn()
    }
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  })

  // ─── TOOL DEFINITION ──────────────────────────────────────────────

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new BulkGetNestedResourcesTool({})
      expect(tool.name).toBe('bulk_get_nested_resources')
    })

    it('should include max batch size in description', () => {
      const tool = new BulkGetNestedResourcesTool({})
      expect(tool.baseDescription).toContain(String(MAX_BATCH_SIZE))
    })

    it('should include serverContext scope in description', () => {
      const tool = new BulkGetNestedResourcesTool({ serverContext: { name: 'Engineer' } })
      expect(tool.baseDescription).toContain('Engineer')
    })

    it('should expose MAX_BATCH_SIZE as 25', () => {
      expect(MAX_BATCH_SIZE).toBe(25)
    })

    it('should have parent_model, parent_ids, child_resource, and expand in inputSchema', () => {
      const tool = new BulkGetNestedResourcesTool({ models: mockModels })
      const schema = tool.inputSchema
      expect(schema.parent_model).toBeDefined()
      expect(schema.parent_ids).toBeDefined()
      expect(schema.child_resource).toBeDefined()
      expect(schema.expand).toBeDefined()
    })

    it('should have parent_model and parent_ids as required, expand as optional', () => {
      const tool = new BulkGetNestedResourcesTool({ models: mockModels })
      const schema = tool.inputSchema
      expect(schema.parent_model.isOptional()).toBe(false)
      expect(schema.parent_ids.isOptional()).toBe(false)
      expect(schema.child_resource.isOptional()).toBe(false)
      expect(schema.expand.isOptional()).toBe(true)
    })
  })

  // ─── BATCH SIZE LIMITS ─────────────────────────────────────────────

  describe('batch size limit', () => {
    it('should enforce max batch size via Zod schema on parent_ids', () => {
      const tool = new BulkGetNestedResourcesTool({ models: mockModels })
      const schema = tool.inputSchema.parent_ids

      const ids26 = Array.from({ length: 26 }, (_, i) => String(i))
      expect(schema.safeParse(ids26).success).toBe(false)

      const ids25 = Array.from({ length: 25 }, (_, i) => String(i))
      expect(schema.safeParse(ids25).success).toBe(true)
    })

    it('should enforce min batch size via Zod schema on parent_ids', () => {
      const tool = new BulkGetNestedResourcesTool({ models: mockModels })
      const schema = tool.inputSchema.parent_ids
      expect(schema.safeParse([]).success).toBe(false)
    })
  })

  // ─── VALIDATION ───────────────────────────────────────────────────

  describe('validation', () => {
    it('should return error when no API client', async () => {
      const tool = new BulkGetNestedResourcesTool({ models: mockModels })
      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['1'],
        child_resource: 'books'
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Not authenticated')
    })

    it('should return error for unknown model', async () => {
      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels
      })
      const result = await tool.execute({
        parent_model: 'nonexistent',
        parent_ids: ['1'],
        child_resource: 'books'
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
    })

    it('should return error for invalid child_resource', async () => {
      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })
      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['1'],
        child_resource: 'nonexistent_resource'
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not a valid nested resource')
    })

    it('should log validation failure with full context', async () => {
      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })
      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['1'],
        child_resource: 'nonexistent_resource'
      })
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Nested resource validation failed',
        expect.objectContaining({
          parentModel: 'activity',
          childResource: 'nonexistent_resource'
        })
      )
    })
  })

  // ─── ALL SUCCEED ──────────────────────────────────────────────────

  describe('all succeed', () => {
    it('should fetch nested resources for all parent IDs and return correct structure', async () => {
      mockApiClient.get
        .mockResolvedValueOnce([{ id: 'b1', title: 'Book One' }])
        .mockResolvedValueOnce([{ id: 'b2', title: 'Book Two' }])
        .mockResolvedValueOnce([])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1', 'a2', 'a3'],
        child_resource: 'books'
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 3, succeeded: 3, failed: 0 })
      expect(body.results).toHaveLength(3)
      expect(body.results[0].parent_id).toBe('a1')
      expect(body.results[0].status).toBe('success')
      expect(body.results[1].parent_id).toBe('a2')
      expect(body.results[2].parent_id).toBe('a3')

      expect(mockApiClient.get).toHaveBeenCalledTimes(3)
      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a1/books', expect.any(Object))
      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a2/books', expect.any(Object))
      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a3/books', expect.any(Object))
    })

    it('should log completion summary', async () => {
      mockApiClient.get.mockResolvedValue([])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'categories'
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Bulk get nested resources completed',
        expect.objectContaining({
          parentModel: 'activity',
          childResource: 'categories',
          total: 1,
          succeeded: 1,
          failed: 0
        })
      )
    })
  })

  // ─── PARTIAL FAILURE ──────────────────────────────────────────────

  describe('partial failure', () => {
    it('should handle mixed success and API errors', async () => {
      mockApiClient.get.mockResolvedValueOnce([{ id: 'b1' }]).mockRejectedValueOnce(
        Object.assign(new Error('Not found'), {
          response: { status: 404, data: 'Activity not found' }
        })
      )

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1', 'a2'],
        child_resource: 'books'
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1 })
      expect(body.results[0]).toMatchObject({ parent_id: 'a1', status: 'success' })
      expect(body.results[1]).toMatchObject({
        parent_id: 'a2',
        status: 'error',
        errors: ['Activity not found']
      })
    })

    it('should extract structured error data from API response', async () => {
      mockApiClient.get.mockRejectedValueOnce(
        Object.assign(new Error('API Error'), {
          response: { status: 422, data: { errors: ['Invalid parent'] } }
        })
      )

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'books'
      })

      const body = JSON.parse(result.content[0].text)
      expect(body.results[0].errors[0]).toContain('Invalid parent')
    })
  })

  // ─── ALL FAIL ─────────────────────────────────────────────────────

  describe('all fail', () => {
    it('should return isError true when all requests fail', async () => {
      mockApiClient.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1', 'a2'],
        child_resource: 'books'
      })

      expect(result.isError).toBe(true)

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2 })
    })

    it('should use error.message when no response data', async () => {
      mockApiClient.get.mockRejectedValueOnce(new Error('Connection refused'))

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'books'
      })

      const body = JSON.parse(result.content[0].text)
      expect(body.results[0].errors[0]).toBe('Connection refused')
    })
  })

  // ─── CUSTOM PATH ──────────────────────────────────────────────────

  describe('custom path', () => {
    it('should use custom path from linkInfo when defined', async () => {
      const modelsWithCustomPath = {
        activity: {
          endpoint: 'activities',
          associations: {
            hasMany: {
              resources: {
                path: 'custom_books',
                target_model: 'book'
              }
            }
          }
        },
        book: { endpoint: 'books' }
      }

      mockApiClient.get.mockResolvedValueOnce([])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: modelsWithCustomPath,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'resources'
      })

      // Uses the custom path 'custom_books' instead of child_resource 'resources'
      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a1/custom_books', {})
    })
  })

  // ─── EXPAND PARAMETER ─────────────────────────────────────────────

  describe('explicit expand', () => {
    it('should pass expand parameter to all API calls', async () => {
      mockApiClient.get.mockResolvedValueOnce([{ id: 'b1' }]).mockResolvedValueOnce([{ id: 'b2' }])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1', 'a2'],
        child_resource: 'books',
        expand: 'author,category'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a1/books', {
        expand: 'author,category'
      })
      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a2/books', {
        expand: 'author,category'
      })
    })
  })

  describe('auto-expand from belongsTo', () => {
    it('should auto-expand from target model metadata when no explicit expand', async () => {
      mockApiClient.get.mockResolvedValueOnce([{ id: 'b1' }])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'books'
      })

      // book model has activity with auto_expand: true in belongsTo
      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a1/books', {
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
  })

  describe('auto-expand from hasMany', () => {
    it('should auto-expand from target model hasMany associations with auto_expand flag', async () => {
      const modelsWithHasManyAutoExpand = {
        activity: {
          endpoint: 'activities',
          associations: {
            hasMany: {
              books: {
                path: 'books',
                target_model: 'book',
                expandable: true
              }
            }
          }
        },
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

      mockApiClient.get.mockResolvedValueOnce([])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: modelsWithHasManyAutoExpand,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'books'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a1/books', {
        expand: 'tags'
      })
    })
  })

  describe('no auto-expand', () => {
    it('should not expand when target model has no auto_expand associations', async () => {
      mockApiClient.get.mockResolvedValueOnce([])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      // categories target model has no associations
      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1'],
        child_resource: 'categories'
      })

      expect(mockApiClient.get).toHaveBeenCalledWith('activities/a1/categories', {})
    })
  })

  // ─── PARALLEL EXECUTION BEHAVIOR ──────────────────────────────────

  // ─── FIELDS PARAMETER ────────────────────────────────────────────

  describe('fields parameter', () => {
    it('should apply fields filtering to each parent result', async () => {
      mockApiClient.get
        .mockResolvedValueOnce([{ id: '1', name: 'Img', type: 'poster', extra: 'x' }])
        .mockResolvedValueOnce([{ id: '2', name: 'Banner', type: 'landscape', extra: 'y' }])

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1', 'a2'],
        child_resource: 'categories',
        fields: ['name', 'type']
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      // Each result.data should have id + name + type only (no extra)
      expect(body.results[0].data).toContain('"name"')
      expect(body.results[0].data).toContain('"type"')
      expect(body.results[0].data).not.toContain('"extra"')
      expect(body.results[1].data).not.toContain('"extra"')
    })
  })

  describe('parallel execution', () => {
    it('should execute API calls in parallel, not sequentially', async () => {
      const callOrder = []
      mockApiClient.get.mockImplementation((endpoint) => {
        callOrder.push(`start:${endpoint}`)
        return new Promise((resolve) => {
          setTimeout(() => {
            callOrder.push(`end:${endpoint}`)
            resolve([])
          }, 10)
        })
      })

      const tool = new BulkGetNestedResourcesTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        parent_model: 'activity',
        parent_ids: ['a1', 'a2', 'a3'],
        child_resource: 'categories'
      })

      // All starts should come before ends (parallel)
      const startIndices = callOrder
        .filter((c) => c.startsWith('start:'))
        .map((c) => callOrder.indexOf(c))
      const endIndices = callOrder
        .filter((c) => c.startsWith('end:'))
        .map((c) => callOrder.indexOf(c))

      expect(startIndices).toHaveLength(3)
      expect(Math.max(...startIndices)).toBeLessThan(Math.max(...endIndices))
      expect(mockApiClient.get).toHaveBeenCalledTimes(3)
    })
  })
})
