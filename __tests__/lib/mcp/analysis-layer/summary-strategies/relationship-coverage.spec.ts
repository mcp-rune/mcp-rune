import { relationshipCoverageStrategy } from '../../../../../src/mcp/analysis-layer/summary-strategies/relationship-coverage.js'
import type {
  SummaryEdge,
  SummaryInput
} from '../../../../../src/mcp/analysis-layer/summary-strategies/types.js'

function makeInput(overrides: Partial<SummaryInput>): SummaryInput {
  return {
    analysisId: 'a1',
    model: 'book',
    page: 1,
    totalPages: 1,
    records: [],
    ...overrides
  }
}

describe('lib/mcp/analysis-layer/summary-strategies/relationship-coverage', () => {
  it('exposes name, description, and requires=["edges"]', () => {
    expect(relationshipCoverageStrategy.name).toBe('relationship-coverage')
    expect(relationshipCoverageStrategy.requires).toEqual(['edges'])
    expect(relationshipCoverageStrategy.description).toMatch(/edge|coverage|relation/i)
  })

  it('appliesTo returns false when edges is absent', () => {
    expect(relationshipCoverageStrategy.appliesTo!(makeInput({ records: [{ id: '1' }] }))).toBe(
      false
    )
  })

  it('appliesTo returns false on empty records even with edges', () => {
    expect(relationshipCoverageStrategy.appliesTo!(makeInput({ records: [], edges: [] }))).toBe(
      false
    )
  })

  it('reports coverage % and degree stats per edge type', async () => {
    const records = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }]
    const edges: SummaryEdge[] = [
      { src_id: 'b1', dst_model: 'author', dst_id: 'a1', edge_type: 'belongsTo:author' },
      { src_id: 'b2', dst_model: 'author', dst_id: 'a2', edge_type: 'belongsTo:author' },
      { src_id: 'b3', dst_model: 'author', dst_id: 'a1', edge_type: 'belongsTo:author' },
      { src_id: 'b1', dst_model: 'genre', dst_id: 'g1', edge_type: 'belongsTo:genre' },
      { src_id: 'b1', dst_model: 'genre', dst_id: 'g2', edge_type: 'belongsTo:genre' }
    ]
    const out = await relationshipCoverageStrategy.generate(makeInput({ records, edges }))
    const stats = out.metadata.edge_types as Record<
      string,
      {
        coverage_pct: number
        unique_sources: number
        mean_degree: number
        max_degree: number
        gap_ids: string[]
      }
    >

    expect(stats['belongsTo:author']!.unique_sources).toBe(3)
    expect(stats['belongsTo:author']!.coverage_pct).toBe(75)
    expect(stats['belongsTo:author']!.max_degree).toBe(1)
    expect(stats['belongsTo:author']!.gap_ids).toEqual(['b4'])

    expect(stats['belongsTo:genre']!.unique_sources).toBe(1)
    expect(stats['belongsTo:genre']!.coverage_pct).toBe(25)
    expect(stats['belongsTo:genre']!.max_degree).toBe(2)
  })

  it('ignores edges whose src_id is not in this page', async () => {
    const records = [{ id: 'b1' }]
    const edges: SummaryEdge[] = [
      { src_id: 'b1', dst_model: 'author', dst_id: 'a1', edge_type: 'belongsTo:author' },
      { src_id: 'b-other', dst_model: 'author', dst_id: 'a2', edge_type: 'belongsTo:author' }
    ]
    const out = await relationshipCoverageStrategy.generate(makeInput({ records, edges }))
    const stats = out.metadata.edge_types as Record<string, { total: number }>
    expect(stats['belongsTo:author']!.total).toBe(1)
  })

  it('produces a "no edges recorded" finding when edge list is empty', async () => {
    const records = [{ id: 'b1' }, { id: 'b2' }]
    const out = await relationshipCoverageStrategy.generate(makeInput({ records, edges: [] }))
    expect(out.finding).toMatch(/no edges recorded/i)
    expect(out.metadata.edge_types).toEqual({})
  })
})
