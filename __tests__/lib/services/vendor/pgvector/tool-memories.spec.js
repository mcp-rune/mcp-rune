import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  storeOperation,
  findSimilar,
  detectGaps,
  getClusters,
  getStats,
  cleanupExpired
} from '../../../../../lib/services/vendor/pgvector/tool-memories.js'

// Mock cosine-similarity
vi.mock('../../../../../lib/services/cosine-similarity.js', () => ({
  cosineSimilarity: vi.fn()
}))

import { cosineSimilarity } from '../../../../../lib/services/cosine-similarity.js'

function createMockPool(rows = [], rowCount = 0) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount })
  }
}

const testEmbedding = new Float32Array([0.1, 0.2, 0.3])

describe('lib/services/vendor/pgvector/tool-memories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('storeOperation', () => {
    it('inserts embedding with metadata and returns id', async () => {
      const pool = createMockPool([{ id: 'uuid-123' }])

      const id = await storeOperation(pool, testEmbedding, {
        toolName: 'create_model',
        toolArgs: { model: 'book', title: 'Test' },
        toolOutput: { id: 1 },
        userId: 'user-1',
        sessionId: 'session-1',
        summary: 'Created a book'
      })

      expect(id).toBe('uuid-123')
      expect(pool.query).toHaveBeenCalledOnce()
      const [sql, params] = pool.query.mock.calls[0]
      expect(sql).toContain('INSERT INTO tool_memories')
      expect(params[0]).toContain('0.1')
      expect(params[0]).toContain('0.2')
      expect(params[0]).toContain('0.3')
      expect(params[1]).toBe('create_model')
      expect(params[2]).toBe('{"model":"book","title":"Test"}')
      expect(params[3]).toBe('user-1')
      expect(params[4]).toBe('session-1')
      expect(params[5]).toBe('Created a book')
      expect(params[6]).toBe('{"id":1}')
    })

    it('handles null optional fields', async () => {
      const pool = createMockPool([{ id: 'uuid-456' }])

      await storeOperation(pool, testEmbedding, {
        toolName: 'find_model',
        summary: 'Found a book'
      })

      const params = pool.query.mock.calls[0][1]
      expect(params[2]).toBeNull() // toolArgs
      expect(params[3]).toBeNull() // userId
      expect(params[4]).toBeNull() // sessionId
      expect(params[6]).toBeNull() // toolOutput
    })
  })

  describe('findSimilar', () => {
    it('returns rows above similarity threshold', async () => {
      const pool = createMockPool([
        { id: '1', tool_name: 'create_model', similarity: 0.9, summary: 'High match' },
        { id: '2', tool_name: 'find_model', similarity: 0.3, summary: 'Low match' }
      ])

      const results = await findSimilar(pool, testEmbedding)

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('1')
    })

    it('applies toolName filter', async () => {
      const pool = createMockPool([])

      await findSimilar(pool, testEmbedding, { toolName: 'create_model' })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain('tool_name = $2')
      expect(pool.query.mock.calls[0][1]).toContain('create_model')
    })

    it('applies days filter', async () => {
      const pool = createMockPool([])

      await findSimilar(pool, testEmbedding, { days: 7 })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain("INTERVAL '7 days'")
    })

    it('applies sessionId filter', async () => {
      const pool = createMockPool([])

      await findSimilar(pool, testEmbedding, { sessionId: 'sess-1' })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain('session_id = $2')
    })

    it('applies multiple filters', async () => {
      const pool = createMockPool([])

      await findSimilar(pool, testEmbedding, {
        toolName: 'create_model',
        days: 7,
        sessionId: 'sess-1'
      })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain('tool_name = $2')
      expect(sql).toContain('session_id = $3')
      expect(sql).toContain("INTERVAL '7 days'")
    })

    it('respects custom topK and threshold', async () => {
      const pool = createMockPool([{ id: '1', similarity: 0.8 }])

      const results = await findSimilar(pool, testEmbedding, {}, { topK: 5, threshold: 0.7 })

      expect(pool.query.mock.calls[0][1]).toContain(5)
      expect(results).toHaveLength(1)
    })

    it('queries without WHERE when no filters', async () => {
      const pool = createMockPool([])

      await findSimilar(pool, testEmbedding)

      const sql = pool.query.mock.calls[0][0]
      expect(sql).not.toContain('WHERE')
    })
  })

  describe('detectGaps', () => {
    it('returns missing steps below threshold', async () => {
      const pool = createMockPool([{ max_similarity: 0.2 }])

      const gaps = await detectGaps(pool, [{ label: 'Step 1', embedding: testEmbedding }])

      expect(gaps).toHaveLength(1)
      expect(gaps[0].step).toBe('Step 1')
      expect(gaps[0].status).toBe('missing')
      expect(gaps[0].confidence).toBe(0.2)
    })

    it('returns incomplete steps between thresholds', async () => {
      const pool = createMockPool([{ max_similarity: 0.5 }])

      const gaps = await detectGaps(pool, [{ label: 'Step 1', embedding: testEmbedding }])

      expect(gaps).toHaveLength(1)
      expect(gaps[0].status).toBe('incomplete')
    })

    it('returns empty for completed steps', async () => {
      const pool = createMockPool([{ max_similarity: 0.85 }])

      const gaps = await detectGaps(pool, [{ label: 'Step 1', embedding: testEmbedding }])

      expect(gaps).toHaveLength(0)
    })

    it('applies recordId filter', async () => {
      const pool = createMockPool([{ max_similarity: 0.9 }])

      await detectGaps(pool, [{ label: 'S1', embedding: testEmbedding }], {
        recordId: '42'
      })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain("tool_args->>'id' = $1")
    })

    it('applies modelName filter', async () => {
      const pool = createMockPool([{ max_similarity: 0.9 }])

      await detectGaps(pool, [{ label: 'S1', embedding: testEmbedding }], {
        modelName: 'book'
      })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain("tool_args->>'model' = $1")
    })

    it('handles null max_similarity', async () => {
      const pool = createMockPool([{ max_similarity: null }])

      const gaps = await detectGaps(pool, [{ label: 'Step 1', embedding: testEmbedding }])

      expect(gaps).toHaveLength(1)
      expect(gaps[0].confidence).toBe(0)
      expect(gaps[0].status).toBe('missing')
    })

    it('respects custom threshold', async () => {
      const pool = createMockPool([{ max_similarity: 0.6 }])

      const gaps = await detectGaps(
        pool,
        [{ label: 'S1', embedding: testEmbedding }],
        {},
        { threshold: 0.5 }
      )

      expect(gaps).toHaveLength(0)
    })
  })

  describe('getClusters', () => {
    it('returns empty for no rows', async () => {
      const pool = createMockPool([])

      const result = await getClusters(pool)

      expect(result).toEqual({ clusters: [], outliers: [] })
    })

    it('clusters similar operations together', async () => {
      const embA = [0.1, 0.2, 0.3]
      const embB = [0.1, 0.2, 0.31]
      const embC = [0.9, 0.8, 0.7]

      const pool = createMockPool([
        {
          id: '1',
          tool_name: 'create_model',
          tool_args: {},
          summary: 'Op 1',
          created_at: new Date(),
          embedding: embA
        },
        {
          id: '2',
          tool_name: 'create_model',
          tool_args: {},
          summary: 'Op 2',
          created_at: new Date(),
          embedding: embB
        },
        {
          id: '3',
          tool_name: 'find_model',
          tool_args: {},
          summary: 'Op 3',
          created_at: new Date(),
          embedding: embC
        }
      ])

      cosineSimilarity.mockReturnValueOnce(0.95) // A vs B -> same cluster
      cosineSimilarity.mockReturnValueOnce(0.2) // A vs C -> different

      const result = await getClusters(pool)

      expect(result.clusters).toHaveLength(1)
      expect(result.clusters[0].count).toBe(2)
      expect(result.outliers).toHaveLength(1)
    })

    it('applies toolName filter', async () => {
      const pool = createMockPool([])

      await getClusters(pool, { toolName: 'create_model' })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain('tool_name = $1')
    })

    it('applies days filter', async () => {
      const pool = createMockPool([])

      await getClusters(pool, { days: 14 })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain("INTERVAL '14 days'")
    })

    it('respects minClusterSize option', async () => {
      const pool = createMockPool([
        {
          id: '1',
          tool_name: 'a',
          tool_args: {},
          summary: 'Op 1',
          created_at: new Date(),
          embedding: [0.1]
        },
        {
          id: '2',
          tool_name: 'a',
          tool_args: {},
          summary: 'Op 2',
          created_at: new Date(),
          embedding: [0.1]
        },
        {
          id: '3',
          tool_name: 'a',
          tool_args: {},
          summary: 'Op 3',
          created_at: new Date(),
          embedding: [0.1]
        }
      ])

      cosineSimilarity.mockReturnValueOnce(0.5) // 1 vs 2 -> not similar
      cosineSimilarity.mockReturnValueOnce(0.5) // 1 vs 3 -> not similar
      cosineSimilarity.mockReturnValueOnce(0.5) // 2 vs 3 -> not similar

      const result = await getClusters(pool, {}, { minClusterSize: 3 })

      expect(result.clusters).toHaveLength(0)
      expect(result.outliers).toHaveLength(3)
    })

    it('includes tool_output in formatted operations when present', async () => {
      const pool = createMockPool([
        {
          id: '1',
          tool_name: 'a',
          tool_args: {},
          tool_output: { result: 'ok' },
          summary: 'Op 1',
          created_at: new Date(),
          embedding: [0.1]
        },
        {
          id: '2',
          tool_name: 'a',
          tool_args: {},
          tool_output: null,
          summary: 'Op 2',
          created_at: new Date(),
          embedding: [0.1]
        }
      ])

      cosineSimilarity.mockReturnValueOnce(0.9)

      const result = await getClusters(pool)

      expect(result.clusters[0].operations[0].toolOutput).toEqual({ result: 'ok' })
      expect(result.clusters[0].operations[1].toolOutput).toBeUndefined()
    })
  })

  describe('getStats', () => {
    it('queries with default days', async () => {
      const pool = createMockPool([{ total: 10, tools: 3 }])

      await getStats(pool)

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain("INTERVAL '30 days'")
      expect(sql).toContain('GROUPING SETS')
    })

    it('applies toolName filter', async () => {
      const pool = createMockPool([])

      await getStats(pool, { toolName: 'create_model', days: 7 })

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain('tool_name = $1')
      expect(sql).toContain("INTERVAL '7 days'")
    })

    it('returns rows directly', async () => {
      const rows = [
        { total: '10', tools: '3', models: '2', records: '5', sessions: '1', tool_name: null },
        {
          total: '6',
          tools: '1',
          models: '1',
          records: '3',
          sessions: '1',
          tool_name: 'create_model'
        }
      ]
      const pool = createMockPool(rows)

      const result = await getStats(pool)

      expect(result).toEqual(rows)
    })
  })

  describe('cleanupExpired', () => {
    it('deletes expired records with default retention', async () => {
      const pool = createMockPool([], 5)

      const count = await cleanupExpired(pool)

      expect(count).toBe(5)
      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain('DELETE FROM tool_memories')
      expect(sql).toContain("INTERVAL '30 days'")
    })

    it('uses custom retention days', async () => {
      const pool = createMockPool([], 0)

      await cleanupExpired(pool, 7)

      const sql = pool.query.mock.calls[0][0]
      expect(sql).toContain("INTERVAL '7 days'")
    })
  })
})
