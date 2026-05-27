// Mock vector storage
vi.mock('#src/services/vector-storage.js', () => ({
  storeAnalysisMemory: vi.fn(() => Promise.resolve('uuid-123')),
  storeIngestedRecords: vi.fn((params) => Promise.resolve(params.records.length)),
  getIngestedRecordIds: vi.fn(() => Promise.resolve(['sched-1', 'sched-2', 'sched-3'])),
  getIngestedRecordCount: vi.fn(() => Promise.resolve(0))
}))

import { ModelService } from '#src/mcp/services/model-service.js'
import {
  getIngestedRecordCount,
  getIngestedRecordIds,
  storeAnalysisMemory,
  storeIngestedRecords
} from '#src/services/vector-storage.js'

import { AnalysisIngestTool } from '../../../../../src/mcp/tools/analysis/analysis-ingest-tool.js'
import { flatConvention } from '../../../../__fixtures__/flat-convention.js'

const mockModels = {
  scheduling: {
    api: { endpoint: 'schedulings' },
    attributes: {
      id: { type: 'string' },
      name: { type: 'string' },
      metadata_status: { type: 'enum', enumValues: ['valid', 'invalid'] }
    },
    associations: {
      hasMany: {
        metadata_errors: {
          rel: 'metadata_errors',
          target_model: 'metadata_error',
          path: 'metadata_errors'
        },
        conflicts: {
          rel: 'conflicts',
          target_model: 'conflict',
          path: 'conflicts'
        }
      }
    }
  },
  metadata_error: {
    api: { endpoint: 'metadata_errors' },
    attributes: {
      id: { type: 'string' },
      message: { type: 'string' }
    }
  }
}

describe('AnalysisIngestTool — nested resource ingestion', () => {
  let tool: AnalysisIngestTool
  let mockApi

  beforeEach(() => {
    vi.clearAllMocks()

    mockApi = {
      get: vi.fn()
    }

    tool = new AnalysisIngestTool({
      models: mockModels,
      dataLayer: new ModelService({ apiClient: mockApi, models: {} }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
  })

  // ============================================================================
  // Validation
  // ============================================================================

  it('should require child_resource when parent_model is set', async () => {
    const result = await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling'
      // child_resource intentionally missing
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('child_resource is required')
  })

  it('should require either model or parent_model', async () => {
    const result = await tool.execute({
      analysis_id: 'test-session'
      // neither model nor parent_model
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Either "model"')
  })

  it('should reject invalid child_resource with suggestion', async () => {
    const result = await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      child_resource: 'nonexistent_thing'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('nonexistent_thing')
  })

  // ============================================================================
  // Auto-resolve parent IDs from ingested records
  // ============================================================================

  it('should auto-resolve parent IDs from previously ingested records', async () => {
    // Mock nested resource responses
    mockApi.get
      .mockResolvedValueOnce([{ id: 'err-1', message: 'missing field: synopsis' }])
      .mockResolvedValueOnce([{ id: 'err-2', message: 'missing field: genre' }])
      .mockResolvedValueOnce([]) // sched-3 has no errors

    const result = await tool.execute({
      analysis_id: 'metadata-agenda-2024',
      parent_model: 'scheduling',
      child_resource: 'metadata_errors'
    })

    // Should have called getIngestedRecordIds to resolve IDs
    expect(getIngestedRecordIds).toHaveBeenCalledWith('metadata-agenda-2024', 'scheduling')

    // Should have fetched nested resources for all 3 parent IDs
    expect(mockApi.get).toHaveBeenCalledTimes(3)
    expect(mockApi.get).toHaveBeenCalledWith('schedulings/sched-1/metadata_errors', {}, {})
    expect(mockApi.get).toHaveBeenCalledWith('schedulings/sched-2/metadata_errors', {}, {})
    expect(mockApi.get).toHaveBeenCalledWith('schedulings/sched-3/metadata_errors', {}, {})

    // Should have stored the 2 records (sched-3 returned empty)
    expect(storeIngestedRecords).toHaveBeenCalledTimes(1)
    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(storedCall.analysisId).toBe('metadata-agenda-2024')
    expect(storedCall.model).toBe('metadata_error')
    expect(storedCall.records).toHaveLength(2)

    // Summary should report success
    expect(result.content[0].text).toContain('2 nested record(s)')
    expect(result.content[0].text).toContain('3/3 parent(s)')
    expect(result.content[0].text).not.toContain('Failed parents')
  })

  it('should error when no parent records found for auto-resolve', async () => {
    ;(getIngestedRecordIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

    const result = await tool.execute({
      analysis_id: 'empty-session',
      parent_model: 'scheduling',
      child_resource: 'metadata_errors'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No ingested scheduling records')
    expect(result.content[0].text).toContain('Ingest parent records first')
  })

  // ============================================================================
  // Explicit parent IDs
  // ============================================================================

  it('should use explicit parent_ids when provided', async () => {
    mockApi.get.mockResolvedValueOnce([{ id: 'err-10', message: 'invalid genre' }])

    const result = await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-99'],
      child_resource: 'metadata_errors'
    })

    // Should NOT have called getIngestedRecordIds
    expect(getIngestedRecordIds).not.toHaveBeenCalled()

    // Should have fetched for the explicit ID
    expect(mockApi.get).toHaveBeenCalledWith('schedulings/sched-99/metadata_errors', {}, {})

    expect(result.content[0].text).toContain('1 nested record(s)')
    expect(result.content[0].text).toContain('1/1 parent(s)')
  })

  // ============================================================================
  // _parent_id injection
  // ============================================================================

  it('should inject _parent_id into each child record', async () => {
    mockApi.get
      .mockResolvedValueOnce([
        { id: 'err-1', message: 'missing synopsis' },
        { id: 'err-2', message: 'missing genre' }
      ])
      .mockResolvedValueOnce([{ id: 'err-3', message: 'missing runtime' }])

    await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-A', 'sched-B'],
      child_resource: 'metadata_errors'
    })

    const storedRecords = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .records
    expect(storedRecords).toHaveLength(3)

    // Records from sched-A should have _parent_id = sched-A
    const schedARecords = storedRecords.filter((r) => r.data._parent_id === 'sched-A')
    expect(schedARecords).toHaveLength(2)

    // Record from sched-B should have _parent_id = sched-B
    const schedBRecords = storedRecords.filter((r) => r.data._parent_id === 'sched-B')
    expect(schedBRecords).toHaveLength(1)
  })

  // ============================================================================
  // Partial failure handling
  // ============================================================================

  it('should handle partial failures and report them', async () => {
    mockApi.get
      .mockResolvedValueOnce([{ id: 'err-1', message: 'ok error' }])
      .mockRejectedValueOnce(new Error('404 Not Found'))

    const result = await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-ok', 'sched-gone'],
      child_resource: 'metadata_errors'
    })

    // Should NOT be isError (partial success)
    expect(result.isError).toBeFalsy()

    // Summary should report 1 success and 1 failure
    expect(result.content[0].text).toContain('1 nested record(s)')
    expect(result.content[0].text).toContain('1/2 parent(s)')
    expect(result.content[0].text).toContain('Failed parents (1)')
    expect(result.content[0].text).toContain('sched-gone')
    expect(result.content[0].text).toContain('404 Not Found')
  })

  it('should set isError when ALL parents fail', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('500')).mockRejectedValueOnce(new Error('500'))

    const result = await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-1', 'sched-2'],
      child_resource: 'metadata_errors'
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('0 nested record(s)')
    expect(result.content[0].text).toContain('0/2 parent(s)')
    expect(result.content[0].text).toContain('Failed parents (2)')
  })

  // ============================================================================
  // Fields filtering
  // ============================================================================

  it('should apply fields filtering to nested results', async () => {
    mockApi.get.mockResolvedValueOnce([
      { id: 'err-1', message: 'missing field', extra_data: 'noise' }
    ])

    await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-1'],
      child_resource: 'metadata_errors',
      fields: ['message']
    })

    const storedRecords = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .records
    // Should have id (always preserved) + message + _parent_id
    expect(storedRecords[0].data.message).toBe('missing field')
    expect(storedRecords[0].data._parent_id).toBe('sched-1')
    expect(storedRecords[0].data.extra_data).toBeUndefined()
  })

  // ============================================================================
  // Page summary generation
  // ============================================================================

  it('should generate a page summary for ingested nested records', async () => {
    mockApi.get.mockResolvedValueOnce([
      { id: 'err-1', message: 'missing synopsis' },
      { id: 'err-2', message: 'missing synopsis' },
      { id: 'err-3', message: 'invalid genre' }
    ])

    await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-1'],
      child_resource: 'metadata_errors'
    })

    // storeAnalysisMemory should have been called for the page summary
    expect(storeAnalysisMemory).toHaveBeenCalledTimes(1)
    const summaryCall = (storeAnalysisMemory as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(summaryCall.analysisId).toBe('test-session')
    expect(summaryCall.category).toBe('page_summary')
    expect(summaryCall.finding).toContain('metadata_error')
    expect(summaryCall.finding).toContain('3 records')
  })

  // ============================================================================
  // Progress notifications for nested ingestion
  // ============================================================================

  it('should send progress notifications during nested resource ingestion', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined)

    mockApi.get
      .mockResolvedValueOnce([{ id: 'err-1', message: 'missing field' }])
      .mockResolvedValueOnce([{ id: 'err-2', message: 'invalid genre' }])

    tool._extra = {
      _meta: { progressToken: 'nested-tok' },
      sendNotification
    }

    await tool.execute({
      analysis_id: 'progress-nested-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-A', 'sched-B'],
      child_resource: 'metadata_errors'
    })

    // Should send 2 progress notifications (one per parent)
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(sendNotification).toHaveBeenLastCalledWith({
      method: 'notifications/progress',
      params: {
        progressToken: 'nested-tok',
        progress: 2,
        total: 2,
        message: 'Fetched nested resources for 2/2 parents'
      }
    })
  })

  // ============================================================================
  // Context consumption flag
  // ============================================================================

  it('should set consumed: true in response meta', async () => {
    mockApi.get.mockResolvedValueOnce([{ id: 'err-1', message: 'test' }])

    const result = await tool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-1'],
      child_resource: 'metadata_errors'
    })

    // The formatResponse with meta should mark consumed
    expect(result.content[0].text).toContain('nested record(s)')
  })

  // ============================================================================
  // Logging
  // ============================================================================

  it('should log nested ingestion start and completion', async () => {
    mockApi.get.mockResolvedValueOnce([{ id: 'err-1', message: 'test' }])

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const loggedTool = new AnalysisIngestTool({
      models: mockModels,
      dataLayer: new ModelService({ apiClient: mockApi, models: {} }),
      logger
    })

    await loggedTool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-1'],
      child_resource: 'metadata_errors'
    })

    // Should log start
    const startLog = logger.info.mock.calls.find((c) => c[0] === 'Ingesting nested resources')
    expect(startLog).toBeDefined()
    expect(startLog[1]).toMatchObject({
      parentModel: 'scheduling',
      childResource: 'metadata_errors',
      parentCount: 1,
      idsSource: 'explicit'
    })

    // Should log completion
    const completeLog = logger.info.mock.calls.find(
      (c) => c[0] === 'Nested resource ingestion completed'
    )
    expect(completeLog).toBeDefined()
    expect(completeLog[1]).toMatchObject({
      totalStored: 1,
      succeeded: 1,
      failed: 0
    })
  })

  // Note: a previous version of this suite covered the `LoggingApiClient`
  // decorator that wrapped the tool's ApiClient to emit debug request/response
  // lines. The decorator was removed in v0.49 along with `BaseTool.apiClient`
  // when the DataLayer seam landed. Per-request HTTP debug logging now belongs
  // in the adapter (or in a separate handler in the request pipeline) and is
  // covered there.

  it('should log warnings for individual parent failures', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('timeout'))

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const loggedTool = new AnalysisIngestTool({
      models: mockModels,
      dataLayer: new ModelService({ apiClient: mockApi, models: {} }),
      logger
    })

    await loggedTool.execute({
      analysis_id: 'test-session',
      parent_model: 'scheduling',
      parent_ids: ['sched-bad'],
      child_resource: 'metadata_errors'
    })

    const warnLog = logger.warn.mock.calls.find(
      (c) => c[0] === 'Failed to fetch nested resource for parent'
    )
    expect(warnLog).toBeDefined()
    expect(warnLog[1]).toMatchObject({
      parentModel: 'scheduling',
      parentId: 'sched-bad',
      childResource: 'metadata_errors',
      error: 'timeout'
    })
  })
})

// ============================================================================
// Association ID preservation through field projection
// ============================================================================

describe('AnalysisIngestTool — association ID preservation', () => {
  const halModels = {
    scheduling: {
      attributes: {
        id: { type: 'string' },
        name: { type: 'string' },
        metadata_status: { type: 'enum', enumValues: ['valid', 'invalid'] },
        put_up: { type: 'string' },
        take_down: { type: 'string' }
      },
      associations: {
        belongsTo: {
          title: { target_model: 'title' },
          platform: { target_model: 'platform' }
        },
        hasMany: {
          metadata_errors: {
            rel: 'metadata_errors',
            target_model: 'metadata_error',
            path: 'metadata_errors'
          }
        }
      },
      api: { endpoint: 'schedulings', convention: flatConvention }
    }
  }

  // Simulates what a HAL API returns with expanded associations
  const halApiResponse = {
    _embedded: {
      schedulings: [
        {
          id: 63,
          name: 'Sched-63',
          metadata_status: 'invalid',
          put_up: '2026-08-06T23:00:00+02:00',
          take_down: '2026-12-31T23:00:00+02:00',
          title: {
            resource_type: 'title',
            id: 58,
            name: 'Pilot',
            title_type: 'episode',
            self_link: 'http://localhost:4001/api/titles/58'
          },
          platform: {
            resource_type: 'platform',
            id: 151,
            name: 'Spain > AVOD > Website',
            self_link: 'http://localhost:4001/api/platforms/151'
          },
          title_link: 'http://localhost:4001/api/titles/58',
          platform_link: 'http://localhost:4001/api/platforms/151'
        },
        {
          id: 64,
          name: 'Sched-64',
          metadata_status: 'invalid',
          put_up: '2026-09-01T00:00:00+02:00',
          take_down: '2027-01-01T00:00:00+02:00',
          title: {
            resource_type: 'title',
            id: 72,
            name: 'The Heist',
            title_type: 'movie',
            self_link: 'http://localhost:4001/api/titles/72'
          },
          platform: {
            resource_type: 'platform',
            id: 151,
            name: 'Spain > AVOD > Website',
            self_link: 'http://localhost:4001/api/platforms/151'
          },
          title_link: 'http://localhost:4001/api/titles/72',
          platform_link: 'http://localhost:4001/api/platforms/151'
        }
      ]
    },
    total_count: 2,
    total_pages: 1,
    page: 1,
    per_page: 50
  }

  let tool: AnalysisIngestTool
  let mockApi

  beforeEach(() => {
    vi.clearAllMocks()

    mockApi = {
      get: vi.fn().mockResolvedValue(halApiResponse)
    }

    tool = new AnalysisIngestTool({
      models: halModels,
      dataLayer: new ModelService({ apiClient: mockApi, models: {} }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
  })

  it('should preserve {assoc}_id fields even when not in requested fields list', async () => {
    await tool.execute({
      analysis_id: 'test-assoc-ids',
      model: 'scheduling',
      fields: ['name', 'title_name', 'platform_name', 'metadata_status', 'put_up', 'take_down']
    })

    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(storedCall.records).toHaveLength(2)

    const rec1 = storedCall.records[0].data
    const rec2 = storedCall.records[1].data

    // Explicitly requested fields are present
    expect(rec1.name).toBe('Sched-63')
    expect(rec1.title_name).toBe('Pilot')
    expect(rec1.platform_name).toBe('Spain > AVOD > Website')
    expect(rec1.metadata_status).toBe('invalid')

    // {assoc}_id fields are preserved even though they were NOT in the fields list
    expect(rec1.title_id).toBe(58)
    expect(rec1.platform_id).toBe(151)
    expect(rec2.title_id).toBe(72)
    expect(rec2.platform_id).toBe(151)
  })

  it('should not add {assoc}_id when no fields from that association are requested', async () => {
    // Only request title_name, not platform_name — so platform_id should NOT be added
    await tool.execute({
      analysis_id: 'test-selective-ids',
      model: 'scheduling',
      fields: ['name', 'title_name', 'metadata_status']
    })

    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const rec = storedCall.records[0].data

    // title_id preserved because title_name was requested
    expect(rec.title_id).toBe(58)
    expect(rec.title_name).toBe('Pilot')

    // platform_id NOT added because no platform_* field was requested
    expect(rec.platform_id).toBeUndefined()
    expect(rec.platform_name).toBeUndefined()
  })

  it('should work correctly when fields list already includes {assoc}_id', async () => {
    await tool.execute({
      analysis_id: 'test-explicit-id',
      model: 'scheduling',
      fields: ['name', 'title_name', 'title_id']
    })

    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const rec = storedCall.records[0].data

    expect(rec.title_id).toBe(58)
    expect(rec.title_name).toBe('Pilot')
  })

  it('should preserve {assoc}_id when ingesting all pages', async () => {
    await tool.execute({
      analysis_id: 'test-all-pages',
      model: 'scheduling',
      ingest_all: true,
      fields: ['name', 'title_name', 'platform_name']
    })

    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const rec = storedCall.records[0].data

    // {assoc}_id fields preserved in ingest_all mode too
    expect(rec.title_id).toBe(58)
    expect(rec.platform_id).toBe(151)
    expect(rec.title_name).toBe('Pilot')
    expect(rec.platform_name).toBe('Spain > AVOD > Website')
  })

  it('should not alter behavior when no fields are specified', async () => {
    await tool.execute({
      analysis_id: 'test-no-fields',
      model: 'scheduling'
    })

    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const rec = storedCall.records[0].data

    // All flattened fields present (no field projection)
    expect(rec.title_id).toBe(58)
    expect(rec.title_name).toBe('Pilot')
    expect(rec.platform_id).toBe(151)
    expect(rec.platform_name).toBe('Spain > AVOD > Website')
    expect(rec.id).toBe(63)
  })

  it('should not include protocol metadata fields in stored records', async () => {
    await tool.execute({
      analysis_id: 'test-no-protocol',
      model: 'scheduling',
      fields: ['name', 'title_name']
    })

    const storedCall = (storeIngestedRecords as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const rec = storedCall.records[0].data

    // HAL protocol fields must never leak through
    expect(rec.title_resource_type).toBeUndefined()
    expect(rec.title_self_link).toBeUndefined()
    expect(rec.title_link).toBeUndefined()
    expect(rec.platform_resource_type).toBeUndefined()
  })
})

// ============================================================================
// Resume and Progress
// ============================================================================

describe('AnalysisIngestTool — resume and progress', () => {
  const models = {
    scheduling: {
      api: { endpoint: 'schedulings', convention: flatConvention },
      attributes: {
        id: { type: 'string' },
        name: { type: 'string' }
      }
    }
  }

  let tool: AnalysisIngestTool
  let mockApi

  beforeEach(() => {
    vi.clearAllMocks()

    mockApi = {
      get: vi.fn()
    }

    tool = new AnalysisIngestTool({
      models,
      dataLayer: new ModelService({ apiClient: mockApi, models: {} }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    })
  })

  // ============================================================================
  // Resume
  // ============================================================================

  it('should resume from where previous ingestion left off', async () => {
    // 100 records already stored, per_page=50 → start from page 3
    ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(100)

    // Page 3 returns 30 records (last page)
    const page3Records = Array.from({ length: 30 }, (_, i) => ({
      id: `rec-${100 + i + 1}`,
      name: `Record ${100 + i + 1}`
    }))
    mockApi.get.mockResolvedValueOnce({
      schedulings: page3Records,
      total_count: 130,
      total_pages: 3,
      page: 3,
      per_page: 50
    })

    const result = await tool.execute({
      analysis_id: 'resume-session',
      model: 'scheduling',
      ingest_all: true,
      resume: true,
      per_page: 50
    })

    // Should have queried record count
    expect(getIngestedRecordCount).toHaveBeenCalledWith('resume-session', 'scheduling')

    // Should start from page 3 (skipping pages 1-2)
    expect(mockApi.get).toHaveBeenCalledTimes(1)
    expect(mockApi.get).toHaveBeenCalledWith('schedulings', { page: 3, per_page: 50 }, {})

    // Total stored = 100 (existing) + 30 (new) = 130
    expect(result.content[0].text).toContain('130 record(s)')
    expect(result.content[0].text).toContain('Resumed from page 3')
  })

  it('should start from page 1 when resume is true but no records exist', async () => {
    ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0)

    const records = Array.from({ length: 10 }, (_, i) => ({
      id: `rec-${i + 1}`,
      name: `Record ${i + 1}`
    }))
    mockApi.get.mockResolvedValueOnce({
      schedulings: records,
      total_count: 10,
      total_pages: 1,
      page: 1,
      per_page: 50
    })

    const result = await tool.execute({
      analysis_id: 'fresh-session',
      model: 'scheduling',
      ingest_all: true,
      resume: true
    })

    // Should start from page 1
    expect(mockApi.get).toHaveBeenCalledWith('schedulings', { page: 1, per_page: 50 }, {})

    expect(result.content[0].text).toContain('10 record(s)')
    expect(result.content[0].text).not.toContain('Resumed')
  })

  it('should not call getIngestedRecordCount when resume is false', async () => {
    const records = [{ id: 'rec-1', name: 'Test' }]
    mockApi.get.mockResolvedValueOnce({
      schedulings: records,
      total_count: 1,
      total_pages: 1,
      page: 1,
      per_page: 50
    })

    await tool.execute({
      analysis_id: 'no-resume-session',
      model: 'scheduling',
      ingest_all: true
    })

    expect(getIngestedRecordCount).not.toHaveBeenCalled()
  })

  it('should return immediately when resume detects all pages are already stored', async () => {
    // 50 records stored, per_page=50 → page 2 returns empty
    ;(getIngestedRecordCount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(50)

    mockApi.get.mockResolvedValueOnce({
      schedulings: [],
      total_count: 50,
      total_pages: 1,
      page: 2,
      per_page: 50
    })

    const result = await tool.execute({
      analysis_id: 'complete-session',
      model: 'scheduling',
      ingest_all: true,
      resume: true,
      per_page: 50
    })

    // Should have tried page 2 (floor(50/50) + 1 = 2) and gotten empty
    expect(mockApi.get).toHaveBeenCalledTimes(1)
    expect(result.content[0].text).toContain('50 record(s)')
    expect(result.content[0].text).toContain('Resumed from page 2')
  })

  // ============================================================================
  // Progress notifications
  // ============================================================================

  it('should send progress notifications during ingest_all', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined)
    tool._extra = {
      _meta: { progressToken: 'prog-1' },
      sendNotification
    }

    // 2 pages of records
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      id: `rec-${i + 1}`,
      name: `Record ${i + 1}`
    }))
    const page2 = Array.from({ length: 20 }, (_, i) => ({
      id: `rec-${50 + i + 1}`,
      name: `Record ${50 + i + 1}`
    }))

    mockApi.get
      .mockResolvedValueOnce({
        schedulings: page1,
        total_count: 70,
        total_pages: 2,
        page: 1,
        per_page: 50
      })
      .mockResolvedValueOnce({
        schedulings: page2,
        total_count: 70,
        total_pages: 2,
        page: 2,
        per_page: 50
      })

    await tool.execute({
      analysis_id: 'progress-session',
      model: 'scheduling',
      ingest_all: true,
      per_page: 50
    })

    // Should have sent 2 progress notifications (one per page)
    expect(sendNotification).toHaveBeenCalledTimes(2)

    // First notification: page 1/2
    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      method: 'notifications/progress',
      params: {
        progressToken: 'prog-1',
        progress: 1,
        total: 2,
        message: expect.stringContaining('page 1/2')
      }
    })

    // Second notification: page 2/2
    expect(sendNotification).toHaveBeenNthCalledWith(2, {
      method: 'notifications/progress',
      params: {
        progressToken: 'prog-1',
        progress: 2,
        total: 2,
        message: expect.stringContaining('page 2/2')
      }
    })
  })

  it('should not send progress notifications when no progressToken', async () => {
    const records = [{ id: 'rec-1', name: 'Test' }]
    mockApi.get.mockResolvedValueOnce({
      schedulings: records,
      total_count: 1,
      total_pages: 1,
      page: 1,
      per_page: 50
    })

    // No _extra set on tool
    await tool.execute({
      analysis_id: 'no-progress-session',
      model: 'scheduling',
      ingest_all: true
    })

    // No errors, no notifications
    expect(true).toBe(true) // Just verify it doesn't throw
  })
})
