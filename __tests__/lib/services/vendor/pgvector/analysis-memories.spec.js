import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  storeMemory,
  recallMemories,
  clearMemories,
  cleanupExpired
} from '../../../../../lib/services/vendor/pgvector/analysis-memories.js'

describe('lib/services/vendor/pgvector/analysis-memories', () => {
  let mockPool

  beforeEach(() => {
    mockPool = {
      query: vi.fn()
    }
  })

  describe('storeMemory', () => {
    it('should insert finding with embedding and metadata', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'uuid-123' }] })

      const embedding = new Float32Array(384).fill(0.1)
      const result = await storeMemory(mockPool, embedding, {
        analysisId: 'audit-2024',
        finding: 'Missing metadata on 15 titles',
        category: 'gap',
        metadata: { count: 15 }
      })

      expect(result).toBe('uuid-123')
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analysis_memories'),
        expect.arrayContaining(['audit-2024', 'Missing metadata on 15 titles', 'gap'])
      )
    })

    it('should default to ephemeral (1 hour expiration)', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'uuid-456' }] })

      const embedding = new Float32Array(384).fill(0.1)
      await storeMemory(mockPool, embedding, {
        analysisId: 'test',
        finding: 'test finding'
      })

      const queryArgs = mockPool.query.mock.calls[0][1]
      expect(queryArgs[5]).toBe(false) // persistent = false
      expect(queryArgs[6]).toBeInstanceOf(Date) // expires_at is set
    })

    it('should set persistent with null expires_at', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'uuid-789' }] })

      const embedding = new Float32Array(384).fill(0.1)
      await storeMemory(mockPool, embedding, {
        analysisId: 'test',
        finding: 'persistent finding',
        persistent: true
      })

      const queryArgs = mockPool.query.mock.calls[0][1]
      expect(queryArgs[5]).toBe(true) // persistent = true
      expect(queryArgs[6]).toBeNull() // expires_at = null
    })

    it('should handle null optional fields', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'uuid-000' }] })

      const embedding = new Float32Array(384).fill(0.1)
      await storeMemory(mockPool, embedding, {
        analysisId: 'test',
        finding: 'minimal finding'
      })

      const queryArgs = mockPool.query.mock.calls[0][1]
      expect(queryArgs[2]).toBeNull() // category
      expect(queryArgs[3]).toBe('{}') // metadata defaults to empty object
    })
  })

  describe('recallMemories', () => {
    it('should recall by analysis ID with cleanup', async () => {
      // First call: cleanup expired
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      // Second call: recall
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'audit-2024',
            finding: 'Gap found',
            category: 'gap',
            metadata: {},
            persistent: false,
            created_at: new Date()
          }
        ]
      })

      const results = await recallMemories(mockPool, { analysisId: 'audit-2024' })

      expect(results).toHaveLength(1)
      expect(results[0].finding).toBe('Gap found')
      // Verify cleanup was called first
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM analysis_memories')
      )
    })

    it('should support semantic query with embedding', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 }) // cleanup
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'audit',
            finding: 'Related finding',
            category: null,
            metadata: {},
            persistent: false,
            created_at: new Date(),
            similarity: 0.85
          }
        ]
      })

      const embedding = new Float32Array(384).fill(0.1)
      const results = await recallMemories(mockPool, { embedding })

      expect(results).toHaveLength(1)
      expect(results[0].similarity).toBe(0.85)
      // Verify embedding was used in query
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('embedding <=>'),
        expect.arrayContaining([expect.stringContaining('[')])
      )
    })

    it('should filter by category', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 }) // cleanup
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await recallMemories(mockPool, { analysisId: 'test', category: 'gap' })

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('category = $'),
        expect.arrayContaining(['test', 'gap'])
      )
    })

    it('should filter out results below threshold in semantic mode', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'test',
            finding: 'high match',
            similarity: 0.9,
            metadata: {},
            created_at: new Date()
          },
          {
            id: 'a2',
            analysis_id: 'test',
            finding: 'low match',
            similarity: 0.3,
            metadata: {},
            created_at: new Date()
          }
        ]
      })

      const embedding = new Float32Array(384).fill(0.1)
      const results = await recallMemories(mockPool, { embedding }, { threshold: 0.5 })

      expect(results).toHaveLength(1)
      expect(results[0].finding).toBe('high match')
    })

    it('should include persistent flag in output', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'test',
            finding: 'persistent finding',
            category: null,
            metadata: {},
            persistent: true,
            created_at: new Date()
          }
        ]
      })

      const results = await recallMemories(mockPool, { analysisId: 'test' })

      expect(results[0].persistent).toBe(true)
    })

    it('should include non-empty metadata in output', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'test',
            finding: 'with metadata',
            category: 'gap',
            metadata: { count: 15, titles: ['T1', 'T2'] },
            persistent: false,
            created_at: new Date()
          }
        ]
      })

      const results = await recallMemories(mockPool, { analysisId: 'test' })

      expect(results[0].metadata).toEqual({ count: 15, titles: ['T1', 'T2'] })
      expect(results[0].category).toBe('gap')
    })

    it('should omit category and metadata when empty/null', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'test',
            finding: 'minimal',
            category: null,
            metadata: {},
            persistent: false,
            created_at: new Date()
          }
        ]
      })

      const results = await recallMemories(mockPool, { analysisId: 'test' })

      expect(results[0]).not.toHaveProperty('category')
      expect(results[0]).not.toHaveProperty('metadata')
      expect(results[0]).not.toHaveProperty('persistent')
    })

    it('should recall with no filters (only expiration condition)', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            analysis_id: 'any',
            finding: 'all findings',
            category: null,
            metadata: {},
            persistent: false,
            created_at: new Date()
          }
        ]
      })

      const results = await recallMemories(mockPool)

      expect(results).toHaveLength(1)
      // Should still have the persistent/expired condition
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('persistent = TRUE OR expires_at > NOW()'),
        expect.any(Array)
      )
    })

    it('should use custom topK option', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 })
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await recallMemories(mockPool, { analysisId: 'test' }, { topK: 10 })

      // topK is passed as a parameter
      const lastCallArgs = mockPool.query.mock.calls[1][1]
      expect(lastCallArgs).toContain(10)
    })
  })

  describe('clearMemories', () => {
    it('should delete by analysis ID', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 5 })

      const count = await clearMemories(mockPool, 'audit-2024')

      expect(count).toBe(5)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM analysis_memories WHERE analysis_id'),
        ['audit-2024']
      )
    })
  })

  describe('cleanupExpired', () => {
    it('should delete non-persistent expired records', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 3 })

      const count = await cleanupExpired(mockPool)

      expect(count).toBe(3)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('persistent = FALSE AND expires_at < NOW()')
      )
    })
  })
})
