import {
  clearEdges,
  getEdgesForSources,
  getEdgesFrom,
  storeEdges
} from '../../../../../src/runtime/vendor/pgvector/ingested-edges.js'

describe('lib/services/vendor/pgvector/ingested-edges', () => {
  let mockPool: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockPool = { query: vi.fn() }
  })

  describe('storeEdges', () => {
    it('returns 0 and does not query when edges is empty', async () => {
      const n = await storeEdges(mockPool as any, { analysisId: 'a1', edges: [] }, 7)
      expect(n).toBe(0)
      expect(mockPool.query).not.toHaveBeenCalled()
    })

    it('emits a multi-row INSERT with ON CONFLICT DO UPDATE and hop_depth LEAST', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 2 })
      const stored = await storeEdges(
        mockPool as any,
        {
          analysisId: 'a1',
          hopDepth: 0,
          edges: [
            {
              src_model: 'book',
              src_id: 'b1',
              dst_model: 'author',
              dst_id: 'auth-1',
              edge_type: 'belongsTo:author'
            },
            {
              src_model: 'book',
              src_id: 'b1',
              dst_model: 'genre',
              dst_id: 'gen-1',
              edge_type: 'belongsTo:genre'
            }
          ]
        },
        7
      )

      expect(stored).toBe(2)
      const sql = mockPool.query.mock.calls[0]![0] as string
      expect(sql).toContain('INSERT INTO ingested_edges')
      expect(sql).toContain(
        '(analysis_id, src_model, src_id, dst_model, dst_id, edge_type, hop_depth, expires_at)'
      )
      expect(sql).toContain(
        'ON CONFLICT (analysis_id, src_model, src_id, dst_model, dst_id, edge_type)'
      )
      expect(sql).toContain('LEAST(ingested_edges.hop_depth, EXCLUDED.hop_depth)')

      const params = mockPool.query.mock.calls[0]![1] as unknown[]
      // 2 rows × 8 cols = 16 params
      expect(params).toHaveLength(16)
      expect(params.slice(0, 7)).toEqual([
        'a1',
        'book',
        'b1',
        'author',
        'auth-1',
        'belongsTo:author',
        0
      ])
    })

    it('respects the retention window for expires_at', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 })
      const before = Date.now()
      await storeEdges(
        mockPool as any,
        {
          analysisId: 'a1',
          edges: [
            {
              src_model: 'book',
              src_id: 'b1',
              dst_model: 'author',
              dst_id: 'auth-1',
              edge_type: 'belongsTo:author'
            }
          ]
        },
        2
      )
      const params = mockPool.query.mock.calls[0]![1] as unknown[]
      const expiresAt = params[7] as Date
      const diff = expiresAt.getTime() - before
      expect(diff).toBeGreaterThanOrEqual(2 * 86_400_000 - 1000)
      expect(diff).toBeLessThanOrEqual(2 * 86_400_000 + 1000)
    })
  })

  describe('getEdgesFrom', () => {
    it('returns rows filtered by (analysis, src_model, src_id)', async () => {
      const rows = [
        {
          src_model: 'book',
          src_id: 'b1',
          dst_model: 'author',
          dst_id: 'auth-1',
          edge_type: 'belongsTo:author',
          hop_depth: 0
        }
      ]
      mockPool.query.mockResolvedValueOnce({ rows })
      const out = await getEdgesFrom(mockPool as any, 'a1', 'book', 'b1')
      expect(out).toEqual(rows)
      const params = mockPool.query.mock.calls[0]![1] as unknown[]
      expect(params).toEqual(['a1', 'book', 'b1'])
    })
  })

  describe('getEdgesForSources', () => {
    it('returns [] and does not query when srcIds is empty', async () => {
      const out = await getEdgesForSources(mockPool as any, 'a1', 'book', [])
      expect(out).toEqual([])
      expect(mockPool.query).not.toHaveBeenCalled()
    })

    it('passes srcIds as a text[] parameter to ANY()', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await getEdgesForSources(mockPool as any, 'a1', 'book', ['b1', 'b2', 'b3'])
      const sql = mockPool.query.mock.calls[0]![0] as string
      expect(sql).toContain('src_id = ANY($3::text[])')
      const params = mockPool.query.mock.calls[0]![1] as unknown[]
      expect(params[2]).toEqual(['b1', 'b2', 'b3'])
    })
  })

  describe('clearEdges', () => {
    it('deletes all rows for an analysis_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 7 })
      const n = await clearEdges(mockPool as any, 'a1')
      expect(n).toBe(7)
      expect(mockPool.query.mock.calls[0]![0]).toContain('DELETE FROM ingested_edges')
    })
  })
})
