import { semanticClusterStrategy } from '../../../../../src/mcp/models/summary-strategies/semantic-cluster.js'
import type { SummaryInput } from '../../../../../src/mcp/models/summary-strategies/types.js'

function unitVec(angle: number): Float32Array {
  const v = new Float32Array(384)
  v[0] = Math.cos(angle)
  v[1] = Math.sin(angle)
  return v
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

describe('lib/core/summary-strategies/semantic-cluster', () => {
  it('exposes name, description, requires=["embeddings"]', () => {
    expect(semanticClusterStrategy.name).toBe('semantic-cluster')
    expect(semanticClusterStrategy.requires).toEqual(['embeddings'])
  })

  it('appliesTo returns false when embeddings are missing', () => {
    expect(semanticClusterStrategy.appliesTo!(makeInput({ records: [{ id: '1' }] }))).toBe(false)
  })

  it('appliesTo returns false when fewer embedded records than k', () => {
    const embeddings = new Map<string, Float32Array>([['1', unitVec(0)]])
    expect(
      semanticClusterStrategy.appliesTo!(
        makeInput({ records: [{ id: '1' }], embeddings, options: { k: 3 } })
      )
    ).toBe(false)
  })

  it('returns k buckets with reasonable size and a representative per cluster', async () => {
    // Two well-separated clusters: angles around 0 and around π
    const records: Array<{ id: string; title: string }> = []
    const embeddings = new Map<string, Float32Array>()
    for (let i = 0; i < 6; i++) {
      const id = `c1-${i}`
      records.push({ id, title: `near-zero-${i}` })
      embeddings.set(id, unitVec(0.01 * i))
    }
    for (let i = 0; i < 6; i++) {
      const id = `c2-${i}`
      records.push({ id, title: `near-pi-${i}` })
      embeddings.set(id, unitVec(Math.PI + 0.01 * i))
    }

    const out = await semanticClusterStrategy.generate(
      makeInput({ records, embeddings, options: { k: 2 } })
    )
    const clusters = out.metadata.clusters as Record<
      string,
      {
        size: number
        representative_id: string
        representative_hint: string | null
        member_ids: string[]
      }
    >
    const keys = Object.keys(clusters)
    expect(keys.length).toBe(2)
    // Each cluster should contain exactly the records near its anchor.
    const sizes = Object.values(clusters).map((c) => c.size)
    expect(sizes.sort()).toEqual([6, 6])
    // Representatives are picked from the records themselves; hints come from `title`.
    for (const c of Object.values(clusters)) {
      expect(c.representative_hint).toMatch(/^near-/)
      expect(c.member_ids).toContain(c.representative_id)
    }
  })

  it('reports embedded_count separately from record_count when not all records are embedded', async () => {
    const records = [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
      { id: '3' /* no embedding */ }
    ]
    const embeddings = new Map<string, Float32Array>([
      ['1', unitVec(0)],
      ['2', unitVec(Math.PI)]
    ])
    const out = await semanticClusterStrategy.generate(
      makeInput({ records, embeddings, options: { k: 2 } })
    )
    expect(out.metadata.record_count).toBe(3)
    expect(out.metadata.embedded_count).toBe(2)
  })
})
