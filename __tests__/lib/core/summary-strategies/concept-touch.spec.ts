import { conceptTouchStrategy } from '../../../../src/core/summary-strategies/concept-touch.js'
import type { SummaryEdge, SummaryInput } from '../../../../src/core/summary-strategies/types.js'

const registryWithReading = {
  knowledge: {
    getConceptsForModel(model: string) {
      if (model === 'book') {
        return [{ name: 'reading-pipeline', models: ['book', 'genre', 'reading_session'] }]
      }
      return []
    }
  }
}

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

describe('lib/core/summary-strategies/concept-touch', () => {
  it('exposes name, description, and requires=["edges","domainRegistry"]', () => {
    expect(conceptTouchStrategy.name).toBe('concept-touch')
    expect(conceptTouchStrategy.requires).toEqual(['edges', 'domainRegistry'])
  })

  it('appliesTo returns false when no concepts cover the model', () => {
    const input = makeInput({
      model: 'unknown',
      records: [{ id: 'b1' }],
      edges: [],
      domainRegistry: registryWithReading
    })
    expect(conceptTouchStrategy.appliesTo!(input)).toBe(false)
  })

  it('appliesTo returns false when edges are missing', () => {
    const input = makeInput({
      records: [{ id: 'b1' }],
      domainRegistry: registryWithReading
    })
    expect(conceptTouchStrategy.appliesTo!(input)).toBe(false)
  })

  it('appliesTo returns true with edges + concept', () => {
    expect(
      conceptTouchStrategy.appliesTo!(
        makeInput({
          records: [{ id: 'b1' }],
          edges: [],
          domainRegistry: registryWithReading
        })
      )
    ).toBe(true)
  })

  it('reports per-concept touched/total counts and gap IDs', async () => {
    const records = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }]
    const edges: SummaryEdge[] = [
      { src_id: 'b1', dst_model: 'genre', dst_id: 'g1', edge_type: 'belongsTo:genre' },
      {
        src_id: 'b2',
        dst_model: 'reading_session',
        dst_id: 'rs1',
        edge_type: 'hasMany:reading_sessions'
      },
      { src_id: 'b3', dst_model: 'genre', dst_id: 'g2', edge_type: 'belongsTo:genre' }
    ]
    const out = await conceptTouchStrategy.generate(
      makeInput({ records, edges, domainRegistry: registryWithReading })
    )
    const slices = out.metadata.concepts as Record<
      string,
      {
        touched: number
        total: number
        missing_ids: string[]
        touched_by_target: Record<string, number>
      }
    >
    expect(slices['reading-pipeline']!.touched).toBe(3)
    expect(slices['reading-pipeline']!.total).toBe(4)
    expect(slices['reading-pipeline']!.missing_ids).toEqual(['b4'])
    expect(slices['reading-pipeline']!.touched_by_target).toEqual({
      genre: 2,
      reading_session: 1
    })
  })

  it('produces a "no concepts" finding when the registry is empty', async () => {
    const out = await conceptTouchStrategy.generate(
      makeInput({
        model: 'unknown',
        records: [{ id: 'x1' }],
        edges: [],
        domainRegistry: { knowledge: { getConceptsForModel: () => [] } }
      })
    )
    expect(out.finding).toMatch(/No concepts/i)
  })
})
