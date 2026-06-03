import {
  resolveConceptForStratifier,
  StratifiersArraySchema,
  StratifierSchema,
  toGraphStratifierSpec
} from '../../../../../src/mcp/tools/analysis/stratifier-validator.js'

const registry = {
  knowledge: {
    getConceptsForModel(model: string) {
      if (model === 'book') {
        return [
          { name: 'reading-pipeline', models: ['book', 'genre', 'reading_session'] },
          { name: 'book-only', models: ['book'] }
        ]
      }
      return []
    }
  }
}

describe('lib/mcp/tools/analysis/stratifier-validator', () => {
  describe('StratifierSchema', () => {
    it('validates each discriminated kind', () => {
      expect(StratifierSchema.parse({ kind: 'concept', concept: 'reading-pipeline' })).toEqual({
        kind: 'concept',
        concept: 'reading-pipeline'
      })
      expect(
        StratifierSchema.parse({ kind: 'edge', edge_type: 'belongsTo:author', bucket: 'count' })
      ).toEqual({ kind: 'edge', edge_type: 'belongsTo:author', bucket: 'count' })
      expect(StratifierSchema.parse({ kind: 'cluster', k: 5 })).toEqual({ kind: 'cluster', k: 5 })
    })

    it('rejects k outside [2, 20]', () => {
      expect(() => StratifierSchema.parse({ kind: 'cluster', k: 1 })).toThrow()
      expect(() => StratifierSchema.parse({ kind: 'cluster', k: 21 })).toThrow()
    })

    it('rejects unknown bucket values', () => {
      expect(() =>
        StratifierSchema.parse({ kind: 'edge', edge_type: 'x', bucket: 'sometimes' })
      ).toThrow()
    })
  })

  describe('StratifiersArraySchema', () => {
    it('caps at 3 entries', () => {
      const four = [
        { kind: 'edge', edge_type: 'a' },
        { kind: 'edge', edge_type: 'b' },
        { kind: 'edge', edge_type: 'c' },
        { kind: 'edge', edge_type: 'd' }
      ]
      expect(() => StratifiersArraySchema.parse(four)).toThrow()
    })

    it('allows 0–3 entries', () => {
      expect(StratifiersArraySchema.parse([])).toEqual([])
      expect(StratifiersArraySchema.parse([{ kind: 'cluster', k: 4 }])).toHaveLength(1)
    })
  })

  describe('resolveConceptForStratifier', () => {
    it('returns target models filtered down to non-source models', () => {
      const r = resolveConceptForStratifier(registry, 'reading-pipeline', 'book')
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.concept).toBe('reading-pipeline')
        expect(r.targetModels).toEqual(['genre', 'reading_session'])
      }
    })

    it('errors when the registry is missing', () => {
      const r = resolveConceptForStratifier(undefined, 'x', 'book')
      expect(r.ok).toBe(false)
    })

    it('errors when the concept is not found for the model', () => {
      const r = resolveConceptForStratifier(registry, 'made-up', 'book')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('Available')
    })

    it('errors when the concept lists only the source model', () => {
      const r = resolveConceptForStratifier(registry, 'book-only', 'book')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('no target models')
    })
  })

  describe('toGraphStratifierSpec', () => {
    it('threads concept resolution into the internal spec', () => {
      const spec = toGraphStratifierSpec(
        { kind: 'concept', concept: 'reading-pipeline' },
        registry,
        'book'
      )
      expect(spec).toEqual({
        kind: 'concept',
        concept: 'reading-pipeline',
        targetModels: ['genre', 'reading_session']
      })
    })

    it('passes edge and cluster shapes through unchanged', () => {
      expect(
        toGraphStratifierSpec(
          { kind: 'edge', edge_type: 'belongsTo:author', bucket: 'present' },
          registry,
          'book'
        )
      ).toEqual({ kind: 'edge', edge_type: 'belongsTo:author', bucket: 'present' })
      expect(toGraphStratifierSpec({ kind: 'cluster', k: 7 }, registry, 'book')).toEqual({
        kind: 'cluster',
        k: 7
      })
    })

    it('throws when concept resolution fails', () => {
      expect(() =>
        toGraphStratifierSpec({ kind: 'concept', concept: 'made-up' }, registry, 'book')
      ).toThrow(/Concept "made-up" not found/)
    })
  })
})
