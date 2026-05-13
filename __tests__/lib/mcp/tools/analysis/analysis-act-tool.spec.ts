vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn().mockResolvedValue(null),
  getIngestedRecordCount: vi.fn(),
  getIngestedRecordIdsFiltered: vi.fn(),
  getIngestedRecordDryRun: vi.fn()
}))

import {
  getIngestedRecordCount,
  getIngestedRecordDryRun,
  getIngestedRecordIdsFiltered,
  storeOperation
} from '#src/services/vector-storage.js'

import {
  AnalysisActTool,
  MAX_ACT_BATCH_SIZE
} from '../../../../../src/mcp/tools/analysis/analysis-act-tool.js'
import { TOOL_CATEGORIES } from '../../../../../src/mcp/tools/categories.js'

describe('lib/mcp/tools/analysis/analysis-act-tool', () => {
  const mockModels = {
    deal: {
      api: { endpoint: 'deals' },
      required: []
    },
    book: {
      api: { endpoint: 'books' },
      required: []
    },
    tag: {
      api: { endpoint: 'tags', readOnly: true },
      description: 'Tags are managed by the system.',
      required: []
    }
  }

  let mockApiClient
  let mockLogger

  beforeEach(() => {
    mockApiClient = { patch: vi.fn(), delete: vi.fn() }
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    ;(storeOperation as ReturnType<typeof vi.fn>).mockClear()
    ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockReset()
    ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockReset()
    ;(getIngestedRecordDryRun as ReturnType<typeof vi.fn>).mockReset()
  })

  describe('metadata', () => {
    it('exposes name, category, requiresAuth, and destructive annotation', () => {
      const tool = new AnalysisActTool({})
      expect(tool.name).toBe('analysis_act')
      expect(AnalysisActTool.category).toBe(TOOL_CATEGORIES.ANALYSIS)
      expect(AnalysisActTool.requiresAuth).toBe(true)
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      })
    })

    it('exposes MAX_ACT_BATCH_SIZE = 50', () => {
      expect(MAX_ACT_BATCH_SIZE).toBe(50)
    })

    it('excludes read-only models from the model enum', () => {
      const tool = new AnalysisActTool({ models: mockModels })
      const opts = (tool.inputSchema.model as { options?: string[] }).options
      expect(opts).toContain('deal')
      expect(opts).not.toContain('tag')
    })
  })

  describe('dry_run', () => {
    it('returns a preview envelope and never hits the API', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(312)
      ;(getIngestedRecordDryRun as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        matchedCount: 312,
        sampleIds: ['d-1', 'd-2', 'd-3'],
        sampleData: [
          { id: 'd-1', status: 'stalled', ingestedAt: '2026-05-13T08:14:22Z' },
          { id: 'd-2', status: 'stalled', ingestedAt: '2026-05-13T08:14:45Z' }
        ],
        earliestIngestedAt: '2026-05-13T08:14:22Z',
        latestIngestedAt: '2026-05-13T08:15:01Z'
      })

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        where: { status: 'stalled' },
        action: 'update',
        attributes: { status: 'archived' },
        dry_run: true
      })

      const body = JSON.parse(result.content[0].text)
      expect(body.matched_count).toBe(312)
      expect(body.sample_ids).toEqual(['d-1', 'd-2', 'd-3'])
      expect(body.sample_data).toHaveLength(2)
      expect(body.ingestedAtRange).toEqual({
        earliest: '2026-05-13T08:14:22Z',
        latest: '2026-05-13T08:15:01Z'
      })
      expect(mockApiClient.patch).not.toHaveBeenCalled()
      expect(mockApiClient.delete).not.toHaveBeenCalled()
      expect(getIngestedRecordIdsFiltered).not.toHaveBeenCalled()
    })
  })

  describe('live update', () => {
    it('applies attributes to every matched record via PATCH with Rails wrapping', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(2)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'd-1',
        'd-2'
      ])
      mockApiClient.patch.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        where: { status: 'stalled' },
        action: 'update',
        attributes: { status: 'archived' }
      })

      expect(result.isError).toBeFalsy()
      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 2, succeeded: 2, failed: 0, action: 'update' })
      expect(body.sample_errors).toEqual([])

      expect(mockApiClient.patch).toHaveBeenCalledTimes(2)
      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'deals/d-1',
        { deal: { status: 'archived' } },
        {}
      )
      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'deals/d-2',
        { deal: { status: 'archived' } },
        {}
      )
    })

    it('batches large ID sets into chunks of MAX_ACT_BATCH_SIZE', async () => {
      const ids = Array.from({ length: 125 }, (_, i) => `d-${i}`)
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(125)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ids)
      mockApiClient.patch.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' }
      })

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 125, succeeded: 125, failed: 0, action: 'update' })
      expect(mockApiClient.patch).toHaveBeenCalledTimes(125)
    })
  })

  describe('live delete', () => {
    it('deletes every matched record via DELETE', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'd-1',
        'd-2',
        'd-3'
      ])
      mockApiClient.delete.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        where: { status: 'never' },
        action: 'delete'
      })

      expect(result.isError).toBeFalsy()
      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 3, succeeded: 3, failed: 0, action: 'delete' })
      expect(mockApiClient.delete).toHaveBeenCalledTimes(3)
      expect(mockApiClient.delete).toHaveBeenCalledWith('deals/d-1', {})
    })

    it('handles compound IDs (paths) as-is', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'titles/42/assets/7'
      ])
      mockApiClient.delete.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'delete'
      })

      expect(mockApiClient.delete).toHaveBeenCalledWith('titles/42/assets/7', {})
    })
  })

  describe('partial failure', () => {
    it('caps sample_errors at 5 and reports accurate counts', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(10)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'd-1',
        'd-2',
        'd-3',
        'd-4',
        'd-5',
        'd-6',
        'd-7',
        'd-8',
        'd-9',
        'd-10'
      ])
      // Resolve the first three, reject the rest with a 422
      const failure = Object.assign(new Error('fail'), {
        response: { status: 422, data: { errors: ['Invalid'] } }
      })
      mockApiClient.patch.mockImplementation((endpoint: string) => {
        const i = Number(endpoint.split('/')[1].slice(2))
        return i <= 3 ? Promise.resolve({}) : Promise.reject(failure)
      })

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' }
      })

      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 10, succeeded: 3, failed: 7, action: 'update' })
      expect(body.sample_errors).toHaveLength(5)
      expect(body.sample_errors[0].status).toBe('api_error')
      expect(body.sample_errors[0].status_code).toBe(422)
    })

    it('marks response as isError when every call fails', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(2)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'd-1',
        'd-2'
      ])
      mockApiClient.patch.mockRejectedValue(
        Object.assign(new Error('boom'), { response: { status: 500, data: 'Internal' } })
      )

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' }
      })

      expect(result.isError).toBe(true)
    })
  })

  describe('validation', () => {
    it("rejects action='update' without attributes", async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValue(10)
      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('attributes')
      expect(mockApiClient.patch).not.toHaveBeenCalled()
    })

    it('rejects read-only models', async () => {
      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'tag',
        action: 'delete'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('read-only')
    })

    it('rejects when no records were ingested for the model', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0)

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'missing-session',
        model: 'deal',
        action: 'delete'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('analysis_ingest')
    })

    it('returns zero-count summary when where matches no rows', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(10)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        where: { status: 'never_match' },
        action: 'delete'
      })

      expect(result.isError).toBeFalsy()
      const body = JSON.parse(result.content[0].text)
      expect(body.summary).toEqual({ total: 0, succeeded: 0, failed: 0, action: 'delete' })
      expect(mockApiClient.delete).not.toHaveBeenCalled()
    })

    it('requires api client (no auth)', async () => {
      const tool = new AnalysisActTool({
        models: mockModels,
        logger: mockLogger
      })

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'delete'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/authenticat/i)
    })
  })

  describe('user_id impersonation', () => {
    it('passes userId through to the api client options', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce(['d-1'])
      mockApiClient.patch.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' },
        user_id: 'svc-acct-uuid'
      })

      expect(mockApiClient.patch).toHaveBeenCalledWith(
        'deals/d-1',
        { deal: { status: 'archived' } },
        { userId: 'svc-acct-uuid' }
      )
    })
  })

  describe('progress notifications', () => {
    it('sends one notification per completed record when client supplies a progressToken', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'd-1',
        'd-2',
        'd-3'
      ])
      mockApiClient.patch.mockResolvedValue({})

      const sendNotification = vi.fn().mockResolvedValue(undefined)
      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })
      tool._extra = {
        _meta: { progressToken: 'act-tok' },
        sendNotification
      }

      await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' }
      })

      expect(sendNotification).toHaveBeenCalledTimes(3)
      expect(sendNotification).toHaveBeenLastCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'act-tok',
          progress: 3,
          total: 3,
          message: 'update: 3/3 records processed'
        }
      })
    })

    it('no-ops when no progressToken is set', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce(['d-1'])
      mockApiClient.patch.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })
      // No _extra set

      const result = await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' }
      })

      expect(result.isError).toBeFalsy()
    })
  })

  describe('tool memory', () => {
    it('logs an analysis_act operation (not bulk_action_models) to vector storage', async () => {
      ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(2)
      ;(getIngestedRecordIdsFiltered as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        'd-1',
        'd-2'
      ])
      mockApiClient.patch.mockResolvedValue({})

      const tool = new AnalysisActTool({
        apiClient: mockApiClient,
        models: mockModels,
        logger: mockLogger
      })

      await tool.execute({
        analysis_id: 'audit-2026',
        model: 'deal',
        action: 'update',
        attributes: { status: 'archived' }
      })

      expect(storeOperation).toHaveBeenCalledTimes(1)
      const call = (storeOperation as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(call.toolName).toBe('analysis_act')
      expect(call.toolArgs).toMatchObject({ model: 'deal', action: 'update', record_count: 2 })
    })
  })
})
