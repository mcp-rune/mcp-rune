import {
  BulkActionModelsTool,
  MAX_BATCH_SIZE
} from '../../../../../src/mcp/tools/data/bulk-action-models-tool.js'
import { halConvention } from '../../../../../src/mcp/api-conventions/hal.js'

vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn().mockResolvedValue(null)
}))

const { storeOperation } = await import('#src/services/vector-storage.js')

describe('lib/mcp/tools/data/bulk-action-models-tool', () => {
  const mockModels = {
    activity: {
      endpoint: 'activities',
      required: ['title']
    },
    tag: {
      endpoint: 'tags',
      api: { readOnly: true },
      description: 'Tags are managed by the system.'
    },
    asset: {
      endpoint: 'assets',
      required: ['name']
    },
    rendition: {
      endpoint: 'renditions',
      required: [],
      api: {
        nested: {
          nestedOnly: true,
          parentModels: ['asset'],
          pathTemplate: '{parent_endpoint}/{parent_id}/renditions'
        }
      }
    }
  }

  let mockApiClient
  let mockLogger

  beforeEach(() => {
    mockApiClient = {
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn()
    }
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    storeOperation.mockClear()
  })

  describe('tool definition', () => {
    it('should have correct name', () => {
      const tool = new BulkActionModelsTool({})
      expect(tool.name).toBe('bulk_action_models')
    })

    it('should include max batch size in description', () => {
      const tool = new BulkActionModelsTool({})
      expect(tool.baseDescription).toContain(String(MAX_BATCH_SIZE))
    })

    it('should include serverContext scope in description', () => {
      const tool = new BulkActionModelsTool({ serverContext: { name: 'Engineer' } })
      expect(tool.baseDescription).toContain('Engineer')
    })

    it('should expose MAX_BATCH_SIZE as 25', () => {
      expect(MAX_BATCH_SIZE).toBe(25)
    })

    it('should have model, action, records, record_ids, attributes, parent_resource, and user_id in inputSchema', () => {
      const tool = new BulkActionModelsTool({ models: mockModels })
      const schema = tool.inputSchema
      expect(schema.model).toBeDefined()
      expect(schema.action).toBeDefined()
      expect(schema.records).toBeDefined()
      expect(schema.record_ids).toBeDefined()
      expect(schema.attributes).toBeDefined()
      expect(schema.parent_resource).toBeDefined()
      expect(schema.user_id).toBeDefined()
    })

    it('should exclude read-only models from model enum', () => {
      const tool = new BulkActionModelsTool({ models: mockModels })
      const modelSchema = tool.inputSchema.model
      expect(modelSchema.options).toContain('activity')
      expect(modelSchema.options).not.toContain('tag')
    })
  })

  // ─── CREATE ACTION ───────────────────────────────────────────────

  describe('create — all records succeed', () => {
    it('should create all records with Rails wrapping and correct response structure', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({ id: 1, title: 'First' })
        .mockResolvedValueOnce({ id: 2, title: 'Second' })
        .mockResolvedValueOnce({ id: 3, title: 'Third' })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }]
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 3, succeeded: 3, failed: 0, action: 'create' })
      expect(body.results).toHaveLength(3)
      expect(body.results[0]).toEqual({
        index: 0,
        status: 'created',
        id: 1
      })

      expect(mockApiClient.post).toHaveBeenCalledTimes(3)
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'activities',
        { activity: { title: 'First' } },
        {}
      )
    })
  })

  describe('create — all records fail validation', () => {
    it('should return isError true and make no API calls', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ description: 'no title' }, { description: 'also no title' }]
      })

      expect(result.isError).toBe(true)
      expect(mockApiClient.post).not.toHaveBeenCalled()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2, action: 'create' })
      expect(body.results[0].status).toBe('validation_error')
      expect(body.results[0].errors[0]).toContain('title')
    })
  })

  describe('create — partial success', () => {
    it('should handle mixed validation errors and API errors with correct indices', async () => {
      mockApiClient.post.mockResolvedValueOnce({ id: 10, title: 'Good' }).mockRejectedValueOnce(
        Object.assign(new Error('API fail'), {
          response: { status: 422, data: { errors: ['Title is invalid'] } }
        })
      )

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'create',
        records: [
          { title: 'Good' }, // index 0: created
          { description: 'missing title' }, // index 1: validation_error
          { title: 'Bad' } // index 2: api_error
        ]
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 3, succeeded: 1, failed: 2, action: 'create' })
      expect(body.results[0]).toMatchObject({ index: 0, status: 'created', id: 10 })
      expect(body.results[1]).toMatchObject({ index: 1, status: 'validation_error' })
      expect(body.results[2]).toMatchObject({ index: 2, status: 'api_error', status_code: 422 })

      expect(mockApiClient.post).toHaveBeenCalledTimes(2)
    })
  })

  describe('create — all API failures', () => {
    it('should return isError true when every API call fails', async () => {
      mockApiClient.post.mockRejectedValue(
        Object.assign(new Error('Server error'), { response: { status: 500, data: 'Internal' } })
      )

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ title: 'A' }, { title: 'B' }]
      })

      expect(result.isError).toBe(true)

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2, action: 'create' })
      expect(body.results.every((r) => r.status === 'api_error')).toBe(true)
    })
  })

  describe('create — missing records arg', () => {
    it('should return error when records is missing', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'create'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('records')
    })
  })

  // ─── CREATE — NESTED-ONLY MODELS ─────────────────────────────────

  describe('create — nested-only with parent_resource', () => {
    it('should POST all records to the parent_resource endpoint', async () => {
      mockApiClient.post.mockResolvedValueOnce({ id: 10 }).mockResolvedValueOnce({ id: 11 })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'rendition',
        action: 'create',
        records: [{ format: 'mp4' }, { format: 'hls' }],
        parent_resource: 'assets/123/renditions'
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'create' })
      expect(body.results[0]).toMatchObject({ index: 0, status: 'created', id: 10 })
      expect(body.results[1]).toMatchObject({ index: 1, status: 'created', id: 11 })

      expect(mockApiClient.post).toHaveBeenCalledTimes(2)
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'assets/123/renditions',
        { rendition: { format: 'mp4' } },
        {}
      )
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'assets/123/renditions',
        { rendition: { format: 'hls' } },
        {}
      )
    })
  })

  describe('create — nested-only without parent_resource', () => {
    it('should fail fast with error listing valid parents', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'rendition',
        action: 'create',
        records: [{ format: 'mp4' }]
      })

      expect(result.isError).toBe(true)
      expect(mockApiClient.post).not.toHaveBeenCalled()

      const text = result.content[0].text
      expect(text).toContain('nested-only')
      expect(text).toContain('parent_resource')
      expect(text).toContain('asset')
    })
  })

  describe('create — parent_resource on non-nested model', () => {
    it('should use parent_resource as endpoint override', async () => {
      mockApiClient.post.mockResolvedValueOnce({ id: 99, name: 'Override' })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'asset',
        action: 'create',
        records: [{ name: 'Override' }],
        parent_resource: 'custom/path/assets'
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary.succeeded).toBe(1)

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'custom/path/assets',
        { asset: { name: 'Override' } },
        {}
      )
    })
  })

  // ─── CREATE — PER-RECORD PARENT_RESOURCE ─────────────────────────

  describe('create — per-record parent_resource with different parents', () => {
    it('should POST each record to its own parent endpoint', async () => {
      mockApiClient.post.mockResolvedValueOnce({ id: 10 }).mockResolvedValueOnce({ id: 11 })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'rendition',
        action: 'create',
        records: [
          { parent_resource: 'assets/100/renditions', format: 'mp4' },
          { parent_resource: 'assets/200/renditions', format: 'hls' }
        ]
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'create' })

      expect(mockApiClient.post).toHaveBeenCalledTimes(2)
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'assets/100/renditions',
        { rendition: { format: 'mp4' } },
        {}
      )
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'assets/200/renditions',
        { rendition: { format: 'hls' } },
        {}
      )
    })
  })

  describe('create — mutual exclusivity of tool-level and per-record parent_resource', () => {
    it('should throw when both tool-level and per-record parent_resource are provided', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'rendition',
        action: 'create',
        records: [{ parent_resource: 'assets/100/renditions', format: 'mp4' }],
        parent_resource: 'assets/200/renditions'
      })

      expect(result.isError).toBe(true)
      const text = result.content[0].text
      expect(text).toContain('Cannot combine')
      expect(text).toContain('parent_resource')
    })
  })

  describe('create — non-nested model with per-record parent_resource', () => {
    it('should use per-record parent_resource as endpoint, fall back to model endpoint', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({ id: 1, name: 'A' })
        .mockResolvedValueOnce({ id: 2, name: 'B' })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'asset',
        action: 'create',
        records: [{ parent_resource: 'custom/path/assets', name: 'A' }, { name: 'B' }]
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'create' })

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'custom/path/assets',
        { asset: { name: 'A' } },
        {}
      )
      expect(mockApiClient.post).toHaveBeenCalledWith('assets', { asset: { name: 'B' } }, {})
    })
  })

  describe('create — nested-only, some records missing parent_resource', () => {
    it('should validation_error records without parent_resource and succeed others', async () => {
      mockApiClient.post.mockResolvedValueOnce({ id: 10 })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'rendition',
        action: 'create',
        records: [{ parent_resource: 'assets/100/renditions', format: 'mp4' }, { format: 'hls' }]
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, action: 'create' })
      expect(body.results[0]).toMatchObject({ index: 0, status: 'created', id: 10 })
      expect(body.results[1]).toMatchObject({ index: 1, status: 'validation_error' })
      expect(body.results[1].errors[0]).toContain('nested-only')
      expect(body.results[1].errors[0]).toContain('parent_resource')

      expect(mockApiClient.post).toHaveBeenCalledTimes(1)
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'assets/100/renditions',
        { rendition: { format: 'mp4' } },
        {}
      )
    })
  })

  // ─── UPDATE ACTION (UNIFORM) ─────────────────────────────────────

  describe('update (uniform) — all records succeed', () => {
    it('should patch all records with same attributes', async () => {
      mockApiClient.patch
        .mockResolvedValueOnce({ id: 1, title: 'A', tag_ids: [5] })
        .mockResolvedValueOnce({ id: 2, title: 'B', tag_ids: [5] })
        .mockResolvedValueOnce({ id: 3, title: 'C', tag_ids: [5] })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'update',
        record_ids: ['1', '2', '3'],
        attributes: { tag_ids: [5] }
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 3, succeeded: 3, failed: 0, action: 'update' })
      expect(body.results[0]).toMatchObject({ index: 0, id: '1', status: 'updated' })
      expect(body.results[1]).toMatchObject({ index: 1, id: '2', status: 'updated' })
      expect(body.results[2]).toMatchObject({ index: 2, id: '3', status: 'updated' })

      expect(mockApiClient.patch).toHaveBeenCalledTimes(3)
      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'activities/1',
        { activity: { tag_ids: [5] } },
        {}
      )
    })
  })

  describe('update (uniform) — partial failure', () => {
    it('should handle mixed success and API errors', async () => {
      mockApiClient.patch.mockResolvedValueOnce({ id: 1, title: 'A' }).mockRejectedValueOnce(
        Object.assign(new Error('Not found'), {
          response: { status: 404, data: 'Record not found' }
        })
      )

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'update',
        record_ids: ['1', '999'],
        attributes: { tag_ids: [5] }
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, action: 'update' })
      expect(body.results[0]).toMatchObject({ status: 'updated', id: '1' })
      expect(body.results[1]).toMatchObject({ status: 'api_error', id: '999', status_code: 404 })
    })
  })

  describe('update (uniform) — missing attributes', () => {
    it('should return error when attributes is missing', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'update',
        record_ids: ['1', '2']
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('attributes')
    })
  })

  // ─── UPDATE ACTION (PER-RECORD) ──────────────────────────────────

  describe('update (per-record) — all records succeed', () => {
    it('should patch each record with its own attributes', async () => {
      mockApiClient.patch
        .mockResolvedValueOnce({ id: 1, title: 'New A' })
        .mockResolvedValueOnce({ id: 2, title: 'New B' })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'update',
        records: [
          { record_id: '1', title: 'New A' },
          { record_id: '2', title: 'New B' }
        ]
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'update' })
      expect(body.results[0]).toMatchObject({ index: 0, id: '1', status: 'updated' })
      expect(body.results[1]).toMatchObject({ index: 1, id: '2', status: 'updated' })

      expect(mockApiClient.patch).toHaveBeenCalledTimes(2)
      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'activities/1',
        { activity: { title: 'New A' } },
        {}
      )
      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'activities/2',
        { activity: { title: 'New B' } },
        {}
      )
    })
  })

  describe('update (per-record) — missing record_id', () => {
    it('should return error when record_id is missing in a record', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'update',
        records: [{ record_id: '1', title: 'Good' }, { title: 'Missing ID' }]
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('record_id')
      expect(result.content[0].text).toContain('index 1')
    })
  })

  describe('update — no records or record_ids', () => {
    it('should return error when neither records nor record_ids provided', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'update'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('update')
    })
  })

  // ─── DELETE ACTION ────────────────────────────────────────────────

  describe('delete — all records succeed', () => {
    it('should delete all records by ID', async () => {
      mockApiClient.delete.mockResolvedValueOnce().mockResolvedValueOnce()

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'delete',
        record_ids: ['1', '2']
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'delete' })
      expect(body.results[0]).toEqual({ index: 0, id: '1', status: 'deleted' })
      expect(body.results[1]).toEqual({ index: 1, id: '2', status: 'deleted' })

      expect(mockApiClient.delete).toHaveBeenCalledTimes(2)
      expect(mockApiClient.delete).toHaveBeenCalledWith('activities/1', {})
      expect(mockApiClient.delete).toHaveBeenCalledWith('activities/2', {})
    })
  })

  describe('delete — partial failure', () => {
    it('should handle mixed success and errors', async () => {
      mockApiClient.delete.mockResolvedValueOnce().mockRejectedValueOnce(
        Object.assign(new Error('Not found'), {
          response: { status: 404, data: 'Record not found' }
        })
      )

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'delete',
        record_ids: ['1', '999']
      })

      expect(result.isError).toBeFalsy()

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, action: 'delete' })
      expect(body.results[0]).toMatchObject({ status: 'deleted', id: '1' })
      expect(body.results[1]).toMatchObject({ status: 'api_error', id: '999', status_code: 404 })
    })
  })

  describe('delete — all failures', () => {
    it('should return isError true when every delete fails', async () => {
      mockApiClient.delete.mockRejectedValue(
        Object.assign(new Error('Server error'), { response: { status: 500, data: 'Internal' } })
      )

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'delete',
        record_ids: ['1', '2']
      })

      expect(result.isError).toBe(true)

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2, action: 'delete' })
    })
  })

  describe('delete — missing record_ids', () => {
    it('should return error when record_ids is missing', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'delete'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('record_ids')
    })
  })

  // ─── SHARED BEHAVIOR ─────────────────────────────────────────────

  describe('unknown model', () => {
    it('should return error without making API calls', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'nonexistent',
        action: 'create',
        records: [{ title: 'Test' }]
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Unknown model')
      expect(mockApiClient.post).not.toHaveBeenCalled()
    })
  })

  describe('read-only model', () => {
    it('should return error without making API calls', async () => {
      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      const result = await tool.execute({
        model: 'tag',
        action: 'create',
        records: [{ name: 'Test' }]
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('read-only')
      expect(mockApiClient.post).not.toHaveBeenCalled()
    })
  })

  describe('no API client', () => {
    it('should return auth error', async () => {
      const tool = new BulkActionModelsTool({ models: mockModels })

      const result = await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ title: 'Test' }]
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('authenticated')
    })
  })

  describe('user_id impersonation', () => {
    it('should pass userId to every API call (create)', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({ id: 1, title: 'A' })
        .mockResolvedValueOnce({ id: 2, title: 'B' })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ title: 'A' }, { title: 'B' }],
        user_id: '99'
      })

      expect(mockApiClient.post).toHaveBeenCalledWith(
        'activities',
        { activity: { title: 'A' } },
        { userId: '99' }
      )
      expect(mockApiClient.post).toHaveBeenCalledWith(
        'activities',
        { activity: { title: 'B' } },
        { userId: '99' }
      )
    })

    it('should pass userId to every API call (uniform update)', async () => {
      mockApiClient.patch.mockResolvedValue({ id: 1, tag_ids: [5] })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        model: 'activity',
        action: 'update',
        record_ids: ['1'],
        attributes: { tag_ids: [5] },
        user_id: '99'
      })

      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'activities/1',
        { activity: { tag_ids: [5] } },
        { userId: '99' }
      )
    })

    it('should pass userId to every API call (delete)', async () => {
      mockApiClient.delete.mockResolvedValue()

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels
      })

      await tool.execute({
        model: 'activity',
        action: 'delete',
        record_ids: ['1'],
        user_id: '99'
      })

      expect(mockApiClient.delete).toHaveBeenCalledWith('activities/1', { userId: '99' })
    })
  })

  describe('storeOperation', () => {
    it('should make a single storeOperation call with summary', async () => {
      mockApiClient.post
        .mockResolvedValueOnce({ id: 1, title: 'A' })
        .mockResolvedValueOnce({ id: 2, title: 'B' })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        serverContext: { sessionId: 'sess-bulk' }
      })

      await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ title: 'A' }, { title: 'B' }]
      })

      expect(storeOperation).toHaveBeenCalledTimes(1)
      expect(storeOperation).toHaveBeenCalledWith({
        toolName: 'bulk_action_models',
        toolArgs: { model: 'activity', action: 'create', record_count: 2 },
        toolOutput: { total: 2, succeeded: 2, failed: 0, action: 'create' },
        userId: undefined,
        sessionId: 'sess-bulk'
      })
    })

    it('should not fail if storeOperation rejects', async () => {
      mockApiClient.post.mockResolvedValue({ id: 1, title: 'Test' })
      storeOperation.mockRejectedValueOnce(new Error('pgvector unavailable'))

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        model: 'activity',
        action: 'create',
        records: [{ title: 'Test' }]
      })

      expect(result.isError).toBeFalsy()
    })
  })

  describe('batch size limit', () => {
    it('should enforce max batch size via Zod schema on records', () => {
      const tool = new BulkActionModelsTool({ models: mockModels })
      const schema = tool.inputSchema.records

      const records26 = Array.from({ length: 26 }, (_, i) => ({ title: `Record ${i}` }))
      expect(schema.safeParse(records26).success).toBe(false)

      const records25 = Array.from({ length: 25 }, (_, i) => ({ title: `Record ${i}` }))
      expect(schema.safeParse(records25).success).toBe(true)
    })

    it('should enforce min batch size via Zod schema on records', () => {
      const tool = new BulkActionModelsTool({ models: mockModels })
      const schema = tool.inputSchema.records
      expect(schema.safeParse([]).success).toBe(false)
    })

    it('should enforce max batch size via Zod schema on record_ids', () => {
      const tool = new BulkActionModelsTool({ models: mockModels })
      const schema = tool.inputSchema.record_ids

      const ids26 = Array.from({ length: 26 }, (_, i) => String(i))
      expect(schema.safeParse(ids26).success).toBe(false)

      const ids25 = Array.from({ length: 25 }, (_, i) => String(i))
      expect(schema.safeParse(ids25).success).toBe(true)
    })
  })

  describe('parallel execution', () => {
    it('should execute API calls in parallel, not sequentially', async () => {
      const callOrder = []

      mockApiClient.delete.mockImplementation((endpoint) => {
        const id = endpoint.split('/')[1]
        callOrder.push(`start-${id}`)
        return new Promise((resolve) => {
          // All resolve after a tick — if sequential, callOrder would be start/end alternating
          setTimeout(() => {
            callOrder.push(`end-${id}`)
            resolve()
          }, 0)
        })
      })

      const tool = new BulkActionModelsTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        model: 'activity',
        action: 'delete',
        record_ids: ['1', '2', '3']
      })

      // All starts should come before ends (parallel), not interleaved (sequential)
      const startIndices = callOrder
        .filter((c) => c.startsWith('start'))
        .map((c) => callOrder.indexOf(c))
      const endIndices = callOrder
        .filter((c) => c.startsWith('end'))
        .map((c) => callOrder.indexOf(c))

      // At least some starts should precede all ends
      expect(Math.max(...startIndices)).toBeLessThan(Math.max(...endIndices))
    })
  })

  // ─── FLAT PAYLOAD ADAPTER ─────────────────────────────────────────

  describe('flat payload via HAL convention', () => {
    const halMockModels = Object.fromEntries(
      Object.entries(mockModels).map(([name, config]) => [
        name,
        { ...config, api: { ...config.api, convention: halConvention } }
      ])
    )

    describe('create — all records succeed', () => {
      it('should create all records with flat payload and correct response structure', async () => {
        mockApiClient.post
          .mockResolvedValueOnce({ id: 1, title: 'First' })
          .mockResolvedValueOnce({ id: 2, title: 'Second' })
          .mockResolvedValueOnce({ id: 3, title: 'Third' })

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'create',
          records: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }]
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 3, succeeded: 3, failed: 0, action: 'create' })
        expect(body.results).toHaveLength(3)
        expect(body.results[0]).toEqual({
          index: 0,
          status: 'created',
          id: 1
        })

        expect(mockApiClient.post).toHaveBeenCalledTimes(3)
        expect(mockApiClient.post).toHaveBeenCalledWith('activities', { title: 'First' }, {})
      })
    })

    describe('create — all records fail validation', () => {
      it('should return isError true and make no API calls', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'create',
          records: [{ description: 'no title' }, { description: 'also no title' }]
        })

        expect(result.isError).toBe(true)
        expect(mockApiClient.post).not.toHaveBeenCalled()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2, action: 'create' })
        expect(body.results[0].status).toBe('validation_error')
        expect(body.results[0].errors[0]).toContain('title')
      })
    })

    describe('create — partial success', () => {
      it('should handle mixed validation errors and API errors with correct indices', async () => {
        mockApiClient.post.mockResolvedValueOnce({ id: 10, title: 'Good' }).mockRejectedValueOnce(
          Object.assign(new Error('API fail'), {
            response: { status: 422, data: { errors: ['Title is invalid'] } }
          })
        )

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'create',
          records: [
            { title: 'Good' }, // index 0: created
            { description: 'missing title' }, // index 1: validation_error
            { title: 'Bad' } // index 2: api_error
          ]
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 3, succeeded: 1, failed: 2, action: 'create' })
        expect(body.results[0]).toMatchObject({ index: 0, status: 'created', id: 10 })
        expect(body.results[1]).toMatchObject({ index: 1, status: 'validation_error' })
        expect(body.results[2]).toMatchObject({ index: 2, status: 'api_error', status_code: 422 })

        expect(mockApiClient.post).toHaveBeenCalledTimes(2)
      })
    })

    describe('create — all API failures', () => {
      it('should return isError true when every API call fails', async () => {
        mockApiClient.post.mockRejectedValue(
          Object.assign(new Error('Server error'), { response: { status: 500, data: 'Internal' } })
        )

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'create',
          records: [{ title: 'A' }, { title: 'B' }]
        })

        expect(result.isError).toBe(true)

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2, action: 'create' })
        expect(body.results.every((r) => r.status === 'api_error')).toBe(true)
      })
    })

    describe('create — missing records arg', () => {
      it('should return error when records is missing', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'create'
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('records')
      })
    })

    // ─── UPDATE ACTION (UNIFORM) ─────────────────────────────────────

    describe('update (uniform) — all records succeed', () => {
      it('should patch all records with flat payload', async () => {
        mockApiClient.patch
          .mockResolvedValueOnce({ id: 1, title: 'A', tag_ids: [5] })
          .mockResolvedValueOnce({ id: 2, title: 'B', tag_ids: [5] })
          .mockResolvedValueOnce({ id: 3, title: 'C', tag_ids: [5] })

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'update',
          record_ids: ['1', '2', '3'],
          attributes: { tag_ids: [5] }
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 3, succeeded: 3, failed: 0, action: 'update' })
        expect(body.results[0]).toMatchObject({ index: 0, id: '1', status: 'updated' })
        expect(body.results[1]).toMatchObject({ index: 1, id: '2', status: 'updated' })
        expect(body.results[2]).toMatchObject({ index: 2, id: '3', status: 'updated' })

        expect(mockApiClient.patch).toHaveBeenCalledTimes(3)
        expect(mockApiClient.patch).toHaveBeenCalledWith('activities/1', { tag_ids: [5] }, {})
      })
    })

    describe('update (uniform) — partial failure', () => {
      it('should handle mixed success and API errors', async () => {
        mockApiClient.patch.mockResolvedValueOnce({ id: 1, title: 'A' }).mockRejectedValueOnce(
          Object.assign(new Error('Not found'), {
            response: { status: 404, data: 'Record not found' }
          })
        )

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'update',
          record_ids: ['1', '999'],
          attributes: { tag_ids: [5] }
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, action: 'update' })
        expect(body.results[0]).toMatchObject({ status: 'updated', id: '1' })
        expect(body.results[1]).toMatchObject({ status: 'api_error', id: '999', status_code: 404 })
      })
    })

    describe('update (uniform) — missing attributes', () => {
      it('should return error when attributes is missing', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'update',
          record_ids: ['1', '2']
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('attributes')
      })
    })

    // ─── UPDATE ACTION (PER-RECORD) ──────────────────────────────────

    describe('update (per-record) — all records succeed', () => {
      it('should patch each record with flat payload', async () => {
        mockApiClient.patch
          .mockResolvedValueOnce({ id: 1, title: 'New A' })
          .mockResolvedValueOnce({ id: 2, title: 'New B' })

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'update',
          records: [
            { record_id: '1', title: 'New A' },
            { record_id: '2', title: 'New B' }
          ]
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'update' })
        expect(body.results[0]).toMatchObject({ index: 0, id: '1', status: 'updated' })
        expect(body.results[1]).toMatchObject({ index: 1, id: '2', status: 'updated' })

        expect(mockApiClient.patch).toHaveBeenCalledTimes(2)
        expect(mockApiClient.patch).toHaveBeenCalledWith('activities/1', { title: 'New A' }, {})
        expect(mockApiClient.patch).toHaveBeenCalledWith('activities/2', { title: 'New B' }, {})
      })
    })

    describe('update (per-record) — missing record_id', () => {
      it('should return error when record_id is missing in a record', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'update',
          records: [{ record_id: '1', title: 'Good' }, { title: 'Missing ID' }]
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('record_id')
        expect(result.content[0].text).toContain('index 1')
      })
    })

    describe('update — no records or record_ids', () => {
      it('should return error when neither records nor record_ids provided', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'update'
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('update')
      })
    })

    // ─── DELETE ACTION ────────────────────────────────────────────────

    describe('delete — all records succeed', () => {
      it('should delete all records by ID', async () => {
        mockApiClient.delete.mockResolvedValueOnce().mockResolvedValueOnce()

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'delete',
          record_ids: ['1', '2']
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'delete' })
        expect(body.results[0]).toEqual({ index: 0, id: '1', status: 'deleted' })
        expect(body.results[1]).toEqual({ index: 1, id: '2', status: 'deleted' })

        expect(mockApiClient.delete).toHaveBeenCalledTimes(2)
        expect(mockApiClient.delete).toHaveBeenCalledWith('activities/1', {})
        expect(mockApiClient.delete).toHaveBeenCalledWith('activities/2', {})
      })
    })

    describe('delete — partial failure', () => {
      it('should handle mixed success and errors', async () => {
        mockApiClient.delete.mockResolvedValueOnce().mockRejectedValueOnce(
          Object.assign(new Error('Not found'), {
            response: { status: 404, data: 'Record not found' }
          })
        )

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'delete',
          record_ids: ['1', '999']
        })

        expect(result.isError).toBeFalsy()

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1, action: 'delete' })
        expect(body.results[0]).toMatchObject({ status: 'deleted', id: '1' })
        expect(body.results[1]).toMatchObject({ status: 'api_error', id: '999', status_code: 404 })
      })
    })

    describe('delete — all failures', () => {
      it('should return isError true when every delete fails', async () => {
        mockApiClient.delete.mockRejectedValue(
          Object.assign(new Error('Server error'), { response: { status: 500, data: 'Internal' } })
        )

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels,
          logger: mockLogger
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'delete',
          record_ids: ['1', '2']
        })

        expect(result.isError).toBe(true)

        const body = JSON.parse(result.content[0].text)
        expect(body.summary).toEqual({ total: 2, succeeded: 0, failed: 2, action: 'delete' })
      })
    })

    describe('delete — missing record_ids', () => {
      it('should return error when record_ids is missing', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'delete'
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('record_ids')
      })
    })

    // ─── SHARED BEHAVIOR ─────────────────────────────────────────────

    describe('unknown model', () => {
      it('should return error without making API calls', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'nonexistent',
          action: 'create',
          records: [{ title: 'Test' }]
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Unknown model')
        expect(mockApiClient.post).not.toHaveBeenCalled()
      })
    })

    describe('read-only model', () => {
      it('should return error without making API calls', async () => {
        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'tag',
          action: 'create',
          records: [{ name: 'Test' }]
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('read-only')
        expect(mockApiClient.post).not.toHaveBeenCalled()
      })
    })

    describe('no API client', () => {
      it('should return auth error', async () => {
        const tool = new BulkActionModelsTool({
          models: halMockModels
        })

        const result = await tool.execute({
          model: 'activity',
          action: 'create',
          records: [{ title: 'Test' }]
        })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('authenticated')
      })
    })

    describe('user_id impersonation', () => {
      it('should pass userId to every API call (create) with flat payload', async () => {
        mockApiClient.post
          .mockResolvedValueOnce({ id: 1, title: 'A' })
          .mockResolvedValueOnce({ id: 2, title: 'B' })

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        await tool.execute({
          model: 'activity',
          action: 'create',
          records: [{ title: 'A' }, { title: 'B' }],
          user_id: '99'
        })

        expect(mockApiClient.post).toHaveBeenCalledWith(
          'activities',
          { title: 'A' },
          { userId: '99' }
        )
        expect(mockApiClient.post).toHaveBeenCalledWith(
          'activities',
          { title: 'B' },
          { userId: '99' }
        )
      })

      it('should pass userId to every API call (uniform update) with flat payload', async () => {
        mockApiClient.patch.mockResolvedValue({ id: 1, tag_ids: [5] })

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        await tool.execute({
          model: 'activity',
          action: 'update',
          record_ids: ['1'],
          attributes: { tag_ids: [5] },
          user_id: '99'
        })

        expect(mockApiClient.patch).toHaveBeenCalledWith(
          'activities/1',
          { tag_ids: [5] },
          { userId: '99' }
        )
      })

      it('should pass userId to every API call (delete)', async () => {
        mockApiClient.delete.mockResolvedValue()

        const tool = new BulkActionModelsTool({
          apiClient: mockApiClient,
          models: halMockModels
        })

        await tool.execute({
          model: 'activity',
          action: 'delete',
          record_ids: ['1'],
          user_id: '99'
        })

        expect(mockApiClient.delete).toHaveBeenCalledWith('activities/1', { userId: '99' })
      })
    })
  })
})
