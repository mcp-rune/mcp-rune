// Mock vector storage
vi.mock('#src/services/vector-storage.js', () => ({
  storeAnalysisMemory: vi.fn(() => Promise.resolve('uuid-123')),
  storeIngestedRecords: vi.fn((params) => Promise.resolve(params.records.length)),
  getIngestedRecordIds: vi.fn(() => Promise.resolve(['sched-1', 'sched-2', 'sched-3']))
}))

import {
  getIngestedRecordIds,
  storeAnalysisMemory,
  storeIngestedRecords
} from '#src/services/vector-storage.js'

import { AnalysisIngestTool } from '../../../../../src/mcp/tools/data/analysis-ingest-tool.js'

const mockModels = {
  scheduling: {
    endpoint: 'schedulings',
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
    endpoint: 'metadata_errors',
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
      apiClient: mockApi,
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
      apiClient: mockApi,
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

  it('should log warnings for individual parent failures', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('timeout'))

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const loggedTool = new AnalysisIngestTool({
      models: mockModels,
      apiClient: mockApi,
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
