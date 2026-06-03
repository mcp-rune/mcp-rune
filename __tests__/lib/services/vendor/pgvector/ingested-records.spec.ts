import {
  getRecordIdsFiltered,
  getRecordsForDryRun,
  queryRecords,
  setRetentionDays,
  storeRecords
} from '../../../../../src/services/vendor/pgvector/ingested-records.js'

describe('lib/services/vendor/pgvector/ingested-records', () => {
  let mockPool: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockPool = {
      query: vi.fn()
    }
    // cleanupExpired runs on every queryRecords call
    mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
  })

  describe('queryRecords — sample mode with where', () => {
    it('should apply where conditions as pre-filter', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', status: null } }]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 5,
        where: { status: 'active' }
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('WITH filtered AS')
      expect(sql).toContain('data @>')
      expect(sql).toContain('ORDER BY RANDOM()')
      expect(sql).toContain('LIMIT')
    })

    it('should apply range operators in where', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', duration: 60 } }]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 5,
        where: { duration_minutes: { $gte: 40, $lte: 120 } }
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('filtered AS')
      expect(sql).toContain("(data->>'duration_minutes')::numeric >=")
      expect(sql).toContain("(data->>'duration_minutes')::numeric <=")
    })
  })

  describe('queryRecords — sample mode with proximity', () => {
    it('should apply date window around origin', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', created_at: '2026-03-14' } }]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 10,
        proximity: {
          field: 'created_at',
          origin: '2026-03-15',
          window: '7 days'
        }
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('filtered AS')
      expect(sql).toContain("(data->>'created_at')::timestamptz >=")
      expect(sql).toContain("'7 days'::interval")
      expect(sql).toContain("(data->>'created_at')::timestamptz <=")
      // Without bucket, should be simple random (no PARTITION BY)
      expect(sql).not.toContain('PARTITION BY')
    })

    it('should use date_bin for bucket stratification', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { data: { id: '1', created_at: '2026-03-14' } },
          { data: { id: '2', created_at: '2026-03-16' } }
        ]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 10,
        proximity: {
          field: 'created_at',
          origin: '2026-03-15',
          window: '7 days',
          bucket: '1 day'
        }
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('date_bin')
      expect(sql).toContain("'1 day'::interval")
      expect(sql).toContain('PARTITION BY')
      expect(sql).toContain('ROW_NUMBER()')
      expect(sql).toContain('num_groups')
    })
  })

  describe('queryRecords — sample mode with where + proximity', () => {
    it('should compose where and proximity conditions', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', status: null, created_at: '2026-03-14' } }]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 10,
        where: { status: null },
        proximity: {
          field: 'created_at',
          origin: '2026-03-15',
          window: '7 days',
          bucket: '1 day'
        }
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      // Both where and proximity conditions in filtered CTE
      expect(sql).toContain('data @>')
      expect(sql).toContain("(data->>'created_at')::timestamptz >=")
      expect(sql).toContain('date_bin')
    })
  })

  describe('queryRecords — composite stratification', () => {
    it('should partition by both discrete field and date bucket', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', status: 'active', created_at: '2026-03-14' } }]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 10,
        stratifyBy: 'status',
        proximity: {
          field: 'created_at',
          origin: '2026-03-15',
          window: '7 days',
          bucket: '1 day'
        }
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      // Should have both partition expressions
      expect(sql).toContain('date_bin')
      expect(sql).toContain("data->>'status'")
      expect(sql).toContain('PARTITION BY')
      // Composite COUNT DISTINCT
      expect(sql).toContain('COUNT(DISTINCT ROW(')
    })
  })

  describe('interval validation', () => {
    it('should reject invalid interval strings', async () => {
      await expect(
        queryRecords(mockPool as any, 'test-analysis', {
          mode: 'sample',
          sampleSize: 5,
          proximity: {
            field: 'created_at',
            origin: '2026-03-15',
            window: '1; DROP TABLE ingested_records;--'
          }
        })
      ).rejects.toThrow('Invalid interval')
    })

    it('should accept valid interval formats', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', created_at: '2026-03-14' } }]
      })

      // Should not throw
      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 5,
        proximity: {
          field: 'created_at',
          origin: '2026-03-15',
          window: '14 days'
        }
      })

      expect(mockPool.query).toHaveBeenCalledTimes(2) // cleanup + query
    })

    it('should reject invalid field names in proximity', async () => {
      await expect(
        queryRecords(mockPool as any, 'test-analysis', {
          mode: 'sample',
          sampleSize: 5,
          proximity: {
            field: 'created_at; DROP TABLE',
            origin: '2026-03-15',
            window: '7 days'
          }
        })
      ).rejects.toThrow('Invalid field name')
    })
  })

  describe('queryRecords — filter mode (regression)', () => {
    it('should use shared buildWhereConditions', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ data: { id: '1', status: 'active' } }]
      })

      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'filter',
        where: { status: 'active', duration_minutes: { $gte: 40 } },
        limit: 10
      })

      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('data @>')
      expect(sql).toContain("(data->>'duration_minutes')::numeric >=")
      expect(sql).toContain('LIMIT')
    })
  })

  describe('getRecordIdsFiltered', () => {
    beforeEach(() => {
      // Override the cleanupExpired pre-mock from outer beforeEach — this helper
      // doesn't call cleanupExpired so the test should start with a clean queue.
      mockPool.query.mockReset()
    })

    it('returns IDs scoped by analysis + model with no where clause', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ record_id: 'a' }, { record_id: 'b' }]
      })

      const ids = await getRecordIdsFiltered(mockPool as any, 'test-analysis', 'deal')

      expect(ids).toEqual(['a', 'b'])
      const [sql, params] = mockPool.query.mock.calls[0]
      expect(sql).toContain('SELECT DISTINCT record_id')
      expect(sql).toContain('analysis_id = $1')
      expect(sql).toContain('model = $2')
      expect(sql).toContain('record_id IS NOT NULL')
      expect(params).toEqual(['test-analysis', 'deal'])
    })

    it('applies exact match where conditions via JSONB containment', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ record_id: 'd-1' }] })

      await getRecordIdsFiltered(mockPool as any, 'test-analysis', 'deal', {
        status: 'stalled'
      })

      const [sql, params] = mockPool.query.mock.calls[0]
      expect(sql).toContain('data @>')
      expect(params).toEqual(['test-analysis', 'deal', JSON.stringify({ status: 'stalled' })])
    })

    it('applies range operators with type casting', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await getRecordIdsFiltered(mockPool as any, 'test-analysis', 'deal', {
        amount: { $gte: 10000 }
      })

      const [sql] = mockPool.query.mock.calls[0]
      expect(sql).toContain("(data->>'amount')::numeric >=")
    })
  })

  describe('getRecordsForDryRun', () => {
    beforeEach(() => {
      mockPool.query.mockReset()
    })

    it('returns matched count, sample IDs, sample data, and ingestedAt range', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              count: 312,
              earliest: '2026-05-13T08:14:22Z',
              latest: '2026-05-13T08:15:01Z'
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              record_id: 'd-1',
              data: { id: 'd-1', status: 'stalled', amount: 5000 },
              created_at: '2026-05-13T08:14:22Z'
            },
            {
              record_id: 'd-2',
              data: { id: 'd-2', status: 'stalled', amount: 7500 },
              created_at: '2026-05-13T08:14:45Z'
            },
            {
              record_id: 'd-3',
              data: { id: 'd-3', status: 'stalled', amount: 12000 },
              created_at: '2026-05-13T08:15:01Z'
            }
          ]
        })

      const result = await getRecordsForDryRun(
        mockPool as any,
        'audit-2026-q2',
        'deal',
        { status: 'stalled' },
        3
      )

      expect(result.matchedCount).toBe(312)
      expect(result.earliestIngestedAt).toBe('2026-05-13T08:14:22Z')
      expect(result.latestIngestedAt).toBe('2026-05-13T08:15:01Z')
      expect(result.sampleIds).toEqual(['d-1', 'd-2', 'd-3'])
      expect(result.sampleData).toHaveLength(3)
      expect(result.sampleData[0]).toMatchObject({
        id: 'd-1',
        status: 'stalled',
        ingestedAt: '2026-05-13T08:14:22Z'
      })
    })

    it('handles empty result set', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: 0, earliest: null, latest: null }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await getRecordsForDryRun(mockPool as any, 'audit-2026-q2', 'deal', {
        status: 'never_match'
      })

      expect(result.matchedCount).toBe(0)
      expect(result.sampleIds).toEqual([])
      expect(result.sampleData).toEqual([])
      expect(result.earliestIngestedAt).toBeNull()
    })

    it('caps sampleIds at 10', async () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        record_id: `d-${i}`,
        data: { id: `d-${i}` },
        created_at: '2026-05-13T08:14:22Z'
      }))
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: 12, earliest: 'x', latest: 'y' }] })
        .mockResolvedValueOnce({ rows })

      const result = await getRecordsForDryRun(mockPool as any, 'a', 'deal', undefined, 3)

      expect(result.sampleIds).toHaveLength(10)
      expect(result.sampleData).toHaveLength(3)
    })
  })

  describe('setRetentionDays', () => {
    let originalDateNow: () => number

    beforeEach(() => {
      mockPool.query.mockReset()
      originalDateNow = Date.now
      Date.now = () => new Date('2026-05-13T12:00:00Z').getTime()
    })

    afterEach(() => {
      Date.now = originalDateNow
      // Restore default for isolation across describe blocks
      setRetentionDays(7)
    })

    it('rejects non-positive values', () => {
      expect(() => setRetentionDays(0)).toThrow(/Invalid retentionDays/)
      expect(() => setRetentionDays(-1)).toThrow(/Invalid retentionDays/)
      expect(() => setRetentionDays(Number.NaN)).toThrow(/Invalid retentionDays/)
    })

    it('affects expires_at on subsequent storeRecords inserts', async () => {
      mockPool.query.mockResolvedValueOnce({})

      setRetentionDays(14)
      await storeRecords(mockPool as any, {
        analysisId: 'a',
        model: 'deal',
        records: [{ id: 'd-1', data: { id: 'd-1' } }]
      })

      const params = mockPool.query.mock.calls[0][1] as unknown[]
      const expiresAt = params[4] as Date
      const expectedMs = Date.now() + 14 * 86_400_000
      expect(expiresAt.getTime()).toBe(expectedMs)
    })

    it('defaults to 7 days', async () => {
      mockPool.query.mockResolvedValueOnce({})

      setRetentionDays(7)
      await storeRecords(mockPool as any, {
        analysisId: 'a',
        model: 'deal',
        records: [{ id: 'd-1', data: { id: 'd-1' } }]
      })

      const params = mockPool.query.mock.calls[0][1] as unknown[]
      const expiresAt = params[4] as Date
      expect(expiresAt.getTime()).toBe(Date.now() + 7 * 86_400_000)
    })
  })

  describe('queryRecords — sample mode with graph stratifiers', () => {
    it('emits a concept-membership CTE and partition expression', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ data: { id: '1' } }] })
      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 10,
        stratifiers: [{ kind: 'concept', concept: 'reading_pipeline', targetModels: ['genre'] }]
      })
      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('concept_reading_pipeline AS')
      expect(sql).toContain('e.dst_model = ANY')
      expect(sql).toContain('PARTITION BY concept_reading_pipeline.concept_flag')
      expect(sql).toContain('LEFT JOIN concept_reading_pipeline')
    })

    it('emits an edge-count CTE with the 4-bucket degree expression', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 6,
        stratifiers: [{ kind: 'edge', edge_type: 'belongsTo:author', bucket: 'count' }]
      })
      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('edge_belongsTo_author AS')
      expect(sql).toContain("THEN '2-5'")
      expect(sql).toContain("ELSE '6+'")
    })

    it('emits anchor + assign CTEs for cluster and binds k as a parameter', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 9,
        stratifiers: [{ kind: 'cluster', k: 4 }]
      })
      const sql = mockPool.query.mock.calls[1][0] as string
      expect(sql).toContain('cluster_anchors AS')
      expect(sql).toContain('cluster_assign AS')
      expect(sql).toContain('embedding <=> a.embedding')
      expect(sql).toContain('PARTITION BY cluster_assign.cluster_id')
      const params = mockPool.query.mock.calls[1][1] as unknown[]
      expect(params).toContain(4)
    })

    it('composes concept + edge + cluster into a multi-CTE WITH list and ROW(...) partition', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await queryRecords(mockPool as any, 'test-analysis', {
        mode: 'sample',
        sampleSize: 12,
        where: { status: 'completed' },
        stratifiers: [
          { kind: 'concept', concept: 'reading_pipeline', targetModels: ['genre'] },
          { kind: 'edge', edge_type: 'belongsTo:author' },
          { kind: 'cluster', k: 3 }
        ]
      })
      const sql = mockPool.query.mock.calls[1][0] as string
      // All three CTEs present
      expect(sql).toContain('concept_reading_pipeline AS')
      expect(sql).toContain('edge_belongsTo_author AS')
      expect(sql).toContain('cluster_anchors AS')
      expect(sql).toContain('cluster_assign AS')
      // Composite partition uses ROW(...)
      expect(sql).toContain('COUNT(DISTINCT ROW(')
      // where condition still applied
      expect(sql).toContain('data @>')
    })

    it('rejects more than 3 stratifiers', async () => {
      await expect(
        queryRecords(mockPool as any, 'test-analysis', {
          mode: 'sample',
          sampleSize: 5,
          stratifiers: [
            { kind: 'edge', edge_type: 'a' },
            { kind: 'edge', edge_type: 'b' },
            { kind: 'edge', edge_type: 'c' },
            { kind: 'edge', edge_type: 'd' }
          ]
        })
      ).rejects.toThrow(/At most 3/)
    })
  })
})
