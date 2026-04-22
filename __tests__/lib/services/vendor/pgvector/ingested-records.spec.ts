import { queryRecords } from '../../../../../src/services/vendor/pgvector/ingested-records.js'

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
})
