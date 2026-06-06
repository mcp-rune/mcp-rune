import { temporalStrategy } from '../../../../../src/mcp/models/summary-strategies/temporal.js'
import type { SummaryInput } from '../../../../../src/mcp/models/summary-strategies/types.js'

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

describe('lib/core/summary-strategies/temporal', () => {
  it('exposes the expected name and description', () => {
    expect(temporalStrategy.name).toBe('temporal')
    expect(temporalStrategy.description).toMatch(/temporal|date|time/i)
  })

  it('appliesTo returns false when no date field exists on the sample', () => {
    const input = makeInput({
      records: [{ id: '1', name: 'no-dates-here' }]
    })
    expect(temporalStrategy.appliesTo!(input)).toBe(false)
  })

  it('appliesTo returns false on empty records', () => {
    expect(temporalStrategy.appliesTo!(makeInput({ records: [] }))).toBe(false)
  })

  it('appliesTo returns true when an ISO-date field is present', () => {
    const input = makeInput({
      records: [{ id: '1', created_at: '2024-05-01T00:00:00Z' }]
    })
    expect(temporalStrategy.appliesTo!(input)).toBe(true)
  })

  it('day-buckets a small date range', async () => {
    const records = [
      { id: '1', created_at: '2024-05-01T00:00:00Z' },
      { id: '2', created_at: '2024-05-01T12:00:00Z' },
      { id: '3', created_at: '2024-05-03T00:00:00Z' }
    ]
    const out = await temporalStrategy.generate(makeInput({ records }))
    const fields = out.metadata.fields as Record<
      string,
      {
        bucket: string
        per_bucket: Record<string, number>
        empty_buckets: number
        span_days: number
      }
    >
    expect(fields.created_at!.bucket).toBe('day')
    expect(fields.created_at!.per_bucket['2024-05-01']).toBe(2)
    expect(fields.created_at!.per_bucket['2024-05-03']).toBe(1)
    expect(fields.created_at!.empty_buckets).toBe(1) // 2024-05-02 missing
    expect(out.finding).toContain('Temporal')
  })

  it('month-buckets a wide date range', async () => {
    const records = [
      { id: '1', created_at: '2023-01-15' },
      { id: '2', created_at: '2023-06-15' },
      { id: '3', created_at: '2024-01-15' }
    ]
    const out = await temporalStrategy.generate(makeInput({ records }))
    const f = (out.metadata.fields as Record<string, { bucket: string }>).created_at!
    expect(f.bucket).toBe('month')
  })

  it('reports no analyzable fields when records lack timestamps', async () => {
    const out = await temporalStrategy.generate(
      makeInput({ records: [{ id: '1', name: 'plain' }] })
    )
    expect(out.metadata.fields).toEqual({})
    expect(out.finding).toContain('No analyzable date fields')
  })
})
