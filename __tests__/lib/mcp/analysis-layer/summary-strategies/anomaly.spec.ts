import { anomalyStrategy } from '../../../../../src/mcp/analysis-layer/summary-strategies/anomaly.js'
import type { SummaryInput } from '../../../../../src/mcp/analysis-layer/summary-strategies/types.js'

function makeInput(overrides: Partial<SummaryInput>): SummaryInput {
  return {
    analysisId: 'a1',
    model: 'scheduling',
    page: 1,
    totalPages: 1,
    records: [],
    ...overrides
  }
}

describe('lib/mcp/analysis-layer/summary-strategies/anomaly', () => {
  it('exposes the expected name and description', () => {
    expect(anomalyStrategy.name).toBe('anomaly')
    expect(anomalyStrategy.description).toMatch(/outlier|anomal/i)
  })

  it('flags insufficient data below the minimum record count', async () => {
    const out = await anomalyStrategy.generate(
      makeInput({
        records: [
          { id: '1', score: 1 },
          { id: '2', score: 100 }
        ]
      })
    )
    expect(out.metadata.insufficient_data).toBe(true)
    expect(out.finding).toContain('Insufficient data')
    expect(out.metadata.numeric_outliers).toBeUndefined()
  })

  it('detects a numeric outlier via z-score', async () => {
    const records = [
      { id: '1', score: 10 },
      { id: '2', score: 11 },
      { id: '3', score: 10 },
      { id: '4', score: 12 },
      { id: '5', score: 11 },
      { id: '6', score: 100 }
    ]
    const out = await anomalyStrategy.generate(makeInput({ records }))
    const outliers = out.metadata.numeric_outliers as Array<{
      field: string
      id?: string
      value: number
      z: number
    }>
    expect(outliers.length).toBeGreaterThan(0)
    const top = outliers[0]!
    expect(top.field).toBe('score')
    expect(top.value).toBe(100)
    expect(top.id).toBe('6')
    expect(Math.abs(top.z)).toBeGreaterThan(2)
    expect(out.finding).toContain('Numeric outliers')
  })

  it('skips outlier detection when stddev is zero', async () => {
    const records = [
      { id: '1', score: 5 },
      { id: '2', score: 5 },
      { id: '3', score: 5 },
      { id: '4', score: 5 }
    ]
    const out = await anomalyStrategy.generate(makeInput({ records }))
    expect(out.metadata.numeric_outliers).toEqual([])
  })

  it('flags rare enum values below the rate threshold', async () => {
    const records = Array.from({ length: 30 }, (_, i) => ({
      id: String(i + 1),
      status: i === 0 ? 'broken' : 'ok'
    }))
    const out = await anomalyStrategy.generate(makeInput({ records }))
    const rares = out.metadata.rare_values as Array<{
      field: string
      value: string
      count: number
      rate: number
    }>
    expect(rares.length).toBe(1)
    expect(rares[0]!.field).toBe('status')
    expect(rares[0]!.value).toBe('broken')
    expect(rares[0]!.count).toBe(1)
    expect(out.finding).toContain('Rare values')
  })

  it('reports "No anomalies detected" when nothing trips a threshold', async () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      status: 'ok'
    }))
    const out = await anomalyStrategy.generate(makeInput({ records }))
    expect(out.finding).toContain('No anomalies detected')
  })
})
