import { entityExtractionStrategy } from '../../../../../src/mcp/analysis-layer/summary-strategies/entity-extraction.js'
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

describe('lib/mcp/analysis-layer/summary-strategies/entity-extraction', () => {
  it('exposes the expected name and description', () => {
    expect(entityExtractionStrategy.name).toBe('entity-extraction')
    expect(entityExtractionStrategy.description).toMatch(/association|entit|id/i)
  })

  it('appliesTo returns false when no *_id field is present besides id', () => {
    const input = makeInput({ records: [{ id: '1', name: 'no-fk' }] })
    expect(entityExtractionStrategy.appliesTo!(input)).toBe(false)
  })

  it('appliesTo returns false on empty records', () => {
    expect(entityExtractionStrategy.appliesTo!(makeInput({ records: [] }))).toBe(false)
  })

  it('appliesTo returns true when an association id is present', () => {
    const input = makeInput({ records: [{ id: '1', title_id: 'tt-9' }] })
    expect(entityExtractionStrategy.appliesTo!(input)).toBe(true)
  })

  it('tallies top association references per field', async () => {
    const records = [
      { id: '1', title_id: 'tt-1', owner_id: 'u-1' },
      { id: '2', title_id: 'tt-1', owner_id: 'u-2' },
      { id: '3', title_id: 'tt-2', owner_id: 'u-1' },
      { id: '4', title_id: 'tt-1', owner_id: null }
    ]
    const out = await entityExtractionStrategy.generate(makeInput({ records }))
    const fields = out.metadata.fields as Record<
      string,
      { total_refs: number; unique_refs: number; top: Array<{ id: string; count: number }> }
    >
    expect(fields.title_id!.total_refs).toBe(4)
    expect(fields.title_id!.unique_refs).toBe(2)
    expect(fields.title_id!.top[0]).toEqual({ id: 'tt-1', count: 3 })
    expect(fields.owner_id!.total_refs).toBe(3)
    expect(fields.owner_id!.unique_refs).toBe(2)
    expect(out.finding).toContain('Entities')
    expect(out.finding).toContain('title_id')
  })

  it('ignores the record id and non-_id fields', async () => {
    const records = [
      { id: '1', name: 'a', tag_id: 't1' },
      { id: '2', name: 'b', tag_id: 't2' }
    ]
    const out = await entityExtractionStrategy.generate(makeInput({ records }))
    const fields = out.metadata.fields as Record<string, unknown>
    expect(Object.keys(fields)).toEqual(['tag_id'])
  })
})
