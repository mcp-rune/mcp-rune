import { distributionStrategy } from '../../../../src/core/summary-strategies/distribution.js'
import type { SummaryInput } from '../../../../src/core/summary-strategies/types.js'

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

describe('lib/core/summary-strategies/distribution', () => {
  it('exposes the expected name and description', () => {
    expect(distributionStrategy.name).toBe('distribution')
    expect(distributionStrategy.description).toMatch(/general-purpose/i)
  })

  it('handles an empty records array', async () => {
    const out = await distributionStrategy.generate(makeInput({ records: [] }))
    expect(out.finding).toBe('Page 1/1 of scheduling records (0 records).')
    expect(out.metadata).toMatchObject({
      page: 1,
      model: 'scheduling',
      record_count: 0,
      distributions: {},
      numericStats: {},
      dateRanges: {}
    })
    expect(out.category).toBeUndefined()
  })

  it('builds field distributions for low-cardinality enum-like fields', async () => {
    const records = [
      { id: '1', status: 'open', flagged: true },
      { id: '2', status: 'open', flagged: false },
      { id: '3', status: 'closed', flagged: true },
      { id: '4', status: 'open', flagged: false }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))

    expect(out.metadata.distributions).toEqual({
      status: { open: 3, closed: 1 },
      flagged: { true: 2, false: 2 }
    })
    expect(out.finding).toContain('Distribution:')
    expect(out.finding).toContain('status: open=3, closed=1')
  })

  it('excludes high-cardinality fields per the 50% unique-values threshold', async () => {
    // 3 unique values in 4 records (75%) > 50% threshold → excluded
    const records = [
      { id: '1', status: 'open' },
      { id: '2', status: 'closed' },
      { id: '3', status: 'pending' },
      { id: '4', status: 'open' }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    expect((out.metadata.distributions as Record<string, unknown>).status).toBeUndefined()
  })

  it('excludes the id field from distributions and stats', async () => {
    const records = [
      { id: 'a', status: 'x' },
      { id: 'b', status: 'x' }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    expect((out.metadata.distributions as Record<string, unknown>).id).toBeUndefined()
  })

  it('skips high-cardinality fields from distributions', async () => {
    // 4 distinct values across 4 records = 100% unique > 50% threshold
    const records = [
      { id: '1', title: 'one' },
      { id: '2', title: 'two' },
      { id: '3', title: 'three' },
      { id: '4', title: 'four' }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    expect((out.metadata.distributions as Record<string, unknown>).title).toBeUndefined()
  })

  it('computes numeric stats (min/max/avg/median/count)', async () => {
    const records = [
      { id: '1', score: 10 },
      { id: '2', score: 20 },
      { id: '3', score: 30 },
      { id: '4', score: 40 }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    expect(out.metadata.numericStats).toEqual({
      score: { min: 10, max: 40, avg: 25, median: 25, count: 4 }
    })
    expect(out.finding).toContain('Numeric stats:')
    expect(out.finding).toContain('score: min=10, max=40, avg=25, median=25, n=4')
  })

  it('uses the middle value as median for odd-length arrays', async () => {
    const records = [
      { id: '1', score: 1 },
      { id: '2', score: 100 },
      { id: '3', score: 5 }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    const stats = (out.metadata.numericStats as Record<string, { median: number }>).score
    expect(stats.median).toBe(5)
  })

  it('builds date ranges for ISO 8601 string fields', async () => {
    const records = [
      { id: '1', created_at: '2024-01-15T00:00:00Z' },
      { id: '2', created_at: '2024-03-20T12:30:00Z' },
      { id: '3', created_at: '2024-02-10T09:00:00Z' }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    expect(out.metadata.dateRanges).toEqual({
      created_at: {
        earliest: '2024-01-15T00:00:00Z',
        latest: '2024-03-20T12:30:00Z',
        count: 3
      }
    })
    expect(out.finding).toContain('Date ranges:')
  })

  it('ignores non-ISO strings when sniffing date fields', async () => {
    const records = [
      { id: '1', label: 'not-a-date' },
      { id: '2', label: 'still-not' }
    ]
    const out = await distributionStrategy.generate(makeInput({ records }))
    expect(out.metadata.dateRanges).toEqual({})
  })

  it('includes the page label when totalPages is known', async () => {
    const out = await distributionStrategy.generate(
      makeInput({ records: [], page: 3, totalPages: 7 })
    )
    expect(out.finding).toContain('Page 3/7')
  })

  it('omits the totalPages suffix when totalPages is null', async () => {
    const out = await distributionStrategy.generate(
      makeInput({ records: [], page: 2, totalPages: null })
    )
    expect(out.finding).toContain('Page 2 of scheduling records')
    expect(out.finding).not.toContain('Page 2/')
  })

  it('mentions the fields list when provided', async () => {
    const out = await distributionStrategy.generate(
      makeInput({ records: [{ id: '1', name: 'x' }], fields: ['id', 'name'] })
    )
    expect(out.finding).toContain('Fields: id, name.')
  })
})
