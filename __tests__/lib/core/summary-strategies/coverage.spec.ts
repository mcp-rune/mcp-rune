import { coverageStrategy } from '../../../../src/core/summary-strategies/coverage.js'
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

describe('lib/core/summary-strategies/coverage', () => {
  it('exposes the expected name and description', () => {
    expect(coverageStrategy.name).toBe('coverage')
    expect(coverageStrategy.description).toMatch(/missing/i)
  })

  it('handles empty records', async () => {
    const out = await coverageStrategy.generate(makeInput({ records: [] }))
    expect(out.metadata.coverage).toEqual({})
    expect(out.metadata.sparse_fields).toEqual([])
    expect(out.finding).toContain('0 records')
  })

  it('computes per-field coverage rates', async () => {
    const records = [
      { id: '1', name: 'a', notes: 'x' },
      { id: '2', name: 'b', notes: null },
      { id: '3', name: 'c', notes: '' },
      { id: '4', name: null, notes: 'y' }
    ]
    const out = await coverageStrategy.generate(makeInput({ records }))
    const cov = out.metadata.coverage as Record<
      string,
      { present: number; missing: number; missing_rate: number }
    >
    expect(cov.id).toEqual({ present: 4, missing: 0, missing_rate: 0 })
    expect(cov.name).toEqual({ present: 3, missing: 1, missing_rate: 0.25 })
    expect(cov.notes).toEqual({ present: 2, missing: 2, missing_rate: 0.5 })
  })

  it('flags fields at or above the sparse threshold', async () => {
    const records = [
      { id: '1', notes: 'x' },
      { id: '2', notes: null },
      { id: '3', notes: null },
      { id: '4', notes: null }
    ]
    const out = await coverageStrategy.generate(makeInput({ records }))
    expect(out.metadata.sparse_fields).toEqual(['notes'])
    expect(out.finding).toContain('Sparse fields')
    expect(out.finding).toContain('notes:')
  })

  it('reports no sparse fields when coverage is dense', async () => {
    const records = [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' }
    ]
    const out = await coverageStrategy.generate(makeInput({ records }))
    expect(out.metadata.sparse_fields).toEqual([])
    expect(out.finding).toContain('No sparse fields')
  })

  it('considers fields present in any record (union of keys)', async () => {
    const records = [
      { id: '1', a: 1 },
      { id: '2', b: 2 }
    ]
    const out = await coverageStrategy.generate(makeInput({ records }))
    const cov = out.metadata.coverage as Record<string, { missing_rate: number }>
    expect(cov.a?.missing_rate).toBe(0.5)
    expect(cov.b?.missing_rate).toBe(0.5)
  })
})
