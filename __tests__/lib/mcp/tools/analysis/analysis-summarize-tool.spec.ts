vi.mock('#src/services/vector-storage.js', () => ({
  storeAnalysisMemory: vi.fn(() => Promise.resolve('memo-1')),
  queryIngestedData: vi.fn(() => Promise.resolve([])),
  describeAnalysisSession: vi.fn(() => Promise.resolve({ model: 'scheduling', totalRecords: 3 }))
}))

import {
  describeAnalysisSession,
  queryIngestedData,
  storeAnalysisMemory
} from '#src/services/vector-storage.js'

import { AnalysisSummarizeTool } from '../../../../../src/mcp/tools/analysis/analysis-summarize-tool.js'

const mockModels = {
  scheduling: {
    api: { endpoint: 'schedulings' },
    attributes: {
      id: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'enum', enumValues: ['valid', 'invalid'] }
    }
  }
}

function makeTool(): AnalysisSummarizeTool {
  return new AnalysisSummarizeTool({
    models: mockModels,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  })
}

describe('AnalysisSummarizeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(queryIngestedData as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '1', name: 'a', status: 'valid' },
      { id: '2', name: 'b', status: 'valid' },
      { id: '3', name: 'c', status: 'invalid' },
      { id: '4', name: 'd', status: 'valid' }
    ])
  })

  it('has the expected name and is not auth-required', () => {
    const tool = makeTool()
    expect(tool.name).toBe('analysis_summarize')
    expect(AnalysisSummarizeTool.getRequiresAuth()).toBe(false)
  })

  it('defaults to the distribution strategy when neither param is given', async () => {
    const tool = makeTool()
    await tool.execute({ analysis_id: 'sess-1' })

    expect(storeAnalysisMemory).toHaveBeenCalledTimes(1)
    const call = (storeAnalysisMemory as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.category).toBe('page_summary:distribution')
    expect(call.metadata.strategy).toBe('distribution')
    expect(call.metadata.source).toBe('analysis_summarize')
  })

  it('resolves the model from describeAnalysisSession when no model param is set', async () => {
    const tool = makeTool()
    await tool.execute({ analysis_id: 'sess-2' })
    expect(describeAnalysisSession).toHaveBeenCalledWith('sess-2')
  })

  it('returns an error when no session is found and no model override is provided', async () => {
    ;(describeAnalysisSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const tool = makeTool()
    const result = await tool.execute({ analysis_id: 'missing' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/No ingested data found/i)
    expect(storeAnalysisMemory).not.toHaveBeenCalled()
  })

  it('uses model override when provided and skips describeAnalysisSession', async () => {
    const tool = makeTool()
    await tool.execute({ analysis_id: 'sess-3', model: 'scheduling' })
    expect(describeAnalysisSession).not.toHaveBeenCalled()
  })

  it('runs each entry in `strategies` and stores one memory per applicable strategy', async () => {
    const tool = makeTool()
    await tool.execute({
      analysis_id: 'sess-multi',
      strategies: ['distribution', 'coverage', 'anomaly']
    })

    const cats = (storeAnalysisMemory as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].category
    )
    expect(cats).toContain('page_summary:distribution')
    expect(cats).toContain('page_summary:coverage')
    // anomaly returns insufficient_data finding (only 4 records meets the threshold)
    expect(cats).toContain('page_summary:anomaly')
  })

  it('silently skips strategies whose appliesTo returns false', async () => {
    // Records have no ISO-date field → temporal.appliesTo returns false
    const tool = makeTool()
    await tool.execute({
      analysis_id: 'sess-skip',
      strategies: ['distribution', 'temporal']
    })

    const cats = (storeAnalysisMemory as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0].category
    )
    expect(cats).toEqual(['page_summary:distribution'])
  })

  it('rejects setting both `strategy` and `strategies`', async () => {
    const tool = makeTool()
    const result = await tool.execute({
      analysis_id: 'sess-both',
      strategy: 'distribution',
      strategies: ['coverage']
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/either .* not both/i)
    expect(storeAnalysisMemory).not.toHaveBeenCalled()
  })

  it('rejects unknown strategy names', async () => {
    const tool = makeTool()
    const result = await tool.execute({
      analysis_id: 'sess-bogus',
      strategy: 'bogus-strategy'
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Unknown summary strategy: "bogus-strategy"/)
  })

  it('uses queryIngestedData mode "filter" when a where clause is provided', async () => {
    const tool = makeTool()
    await tool.execute({
      analysis_id: 'sess-where',
      where: { status: 'invalid' },
      max_records: 250
    })
    expect(queryIngestedData).toHaveBeenCalledWith('sess-where', {
      mode: 'filter',
      where: { status: 'invalid' },
      limit: 250
    })
  })

  it('uses queryIngestedData mode "sample" with a cap when no where is provided', async () => {
    const tool = makeTool()
    await tool.execute({ analysis_id: 'sess-sample', max_records: 500 })
    expect(queryIngestedData).toHaveBeenCalledWith('sess-sample', {
      mode: 'sample',
      sampleSize: 500
    })
  })

  it('reports per-strategy outcomes in the response text', async () => {
    const tool = makeTool()
    const result = await tool.execute({
      analysis_id: 'sess-report',
      strategies: ['distribution', 'temporal']
    })
    expect(result.content[0].text).toContain('Re-summarized 4 record(s)')
    expect(result.content[0].text).toContain('distribution: stored')
    expect(result.content[0].text).toContain('temporal: skipped (appliesTo=false)')
  })
})
