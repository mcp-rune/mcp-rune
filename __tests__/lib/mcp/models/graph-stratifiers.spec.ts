import {
  buildClusterStratifier,
  buildConceptStratifier,
  buildEdgeStratifier,
  type ParamRef
} from '../../../../src/mcp/models/graph-stratifiers.js'

function freshRef(startAt = 2): ParamRef {
  return { next: startAt, params: [] }
}

describe('lib/core/graph-stratifiers', () => {
  describe('buildConceptStratifier', () => {
    it('emits a CTE that joins filtered → ingested_edges and yields a binary flag', () => {
      const ref = freshRef()
      const frag = buildConceptStratifier(
        { concept: 'reading-pipeline', targetModels: ['genre', 'reading_session'] },
        ref
      )

      expect(frag.cte?.name).toBe('concept_reading_pipeline')
      expect(frag.cte?.body).toContain('FROM filtered f')
      expect(frag.cte?.body).toContain('FROM ingested_edges e')
      expect(frag.cte?.body).toContain('e.dst_model = ANY($2::text[])')
      expect(frag.partitionExpr).toBe('concept_reading_pipeline.concept_flag')
      expect(frag.join).toBe(
        'LEFT JOIN concept_reading_pipeline ON concept_reading_pipeline.rid = filtered.id'
      )
      expect(ref.next).toBe(3)
      expect(ref.params).toEqual([['genre', 'reading_session']])
    })

    it('throws on invalid concept names', () => {
      expect(() =>
        buildConceptStratifier({ concept: 'has spaces', targetModels: ['x'] }, freshRef())
      ).toThrow(/Invalid concept name/)
    })
  })

  describe('buildEdgeStratifier', () => {
    it('defaults to bucket: "present" → binary flag expression', () => {
      const ref = freshRef()
      const frag = buildEdgeStratifier({ edge_type: 'belongsTo:author' }, ref)
      expect(frag.cte?.name).toBe('edge_belongsTo_author')
      expect(frag.partitionExpr).toContain('edge_belongsTo_author.edge_n > 0 THEN 1 ELSE 0')
      expect(ref.params).toEqual(['belongsTo:author'])
    })

    it('emits the 4-bucket degree expression for bucket: "count"', () => {
      const ref = freshRef()
      const frag = buildEdgeStratifier({ edge_type: 'hasMany:reviews', bucket: 'count' }, ref)
      expect(frag.partitionExpr).toContain("THEN '0'")
      expect(frag.partitionExpr).toContain("THEN '1'")
      expect(frag.partitionExpr).toContain("THEN '2-5'")
      expect(frag.partitionExpr).toContain("ELSE '6+'")
    })

    it('produces a CTE that counts edges per filtered record', () => {
      const ref = freshRef()
      const frag = buildEdgeStratifier({ edge_type: 'fk:owner_id' }, ref)
      expect(frag.cte?.body).toContain('SELECT COUNT(*) FROM ingested_edges')
      expect(frag.cte?.body).toContain('e.edge_type = $2')
    })
  })

  describe('buildClusterStratifier', () => {
    it('returns paired anchor + assign CTEs and a cluster_id partition expr', () => {
      const ref = freshRef()
      const { fragments, anchorsCte } = buildClusterStratifier({ k: 5 }, ref)
      expect(anchorsCte.name).toBe('cluster_anchors')
      expect(anchorsCte.body).toContain('ROW_NUMBER() OVER (ORDER BY RANDOM())')
      expect(anchorsCte.body).toContain('LIMIT $2')
      expect(fragments.cte?.name).toBe('cluster_assign')
      expect(fragments.cte?.body).toContain('ORDER BY f.embedding <=> a.embedding LIMIT 1')
      expect(fragments.partitionExpr).toBe('cluster_assign.cluster_id')
      expect(fragments.join).toBe('LEFT JOIN cluster_assign ON cluster_assign.rid = filtered.id')
      expect(ref.params).toEqual([5])
    })

    it('rejects k outside [2, 20]', () => {
      expect(() => buildClusterStratifier({ k: 1 }, freshRef())).toThrow(/Invalid cluster k/)
      expect(() => buildClusterStratifier({ k: 21 }, freshRef())).toThrow(/Invalid cluster k/)
      expect(() => buildClusterStratifier({ k: 5.5 }, freshRef())).toThrow(/Invalid cluster k/)
    })
  })

  describe('paramIdx threading across multiple builders', () => {
    it('each builder advances ref.next by the placeholders it pushed', () => {
      const ref = freshRef(10)
      buildConceptStratifier({ concept: 'foo', targetModels: ['m'] }, ref)
      expect(ref.next).toBe(11)
      buildEdgeStratifier({ edge_type: 'belongsTo:bar', bucket: 'count' }, ref)
      expect(ref.next).toBe(12)
      buildClusterStratifier({ k: 3 }, ref)
      expect(ref.next).toBe(13)
      expect(ref.params).toEqual([['m'], 'belongsTo:bar', 3])
    })
  })
})
