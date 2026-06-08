// Mock the four impl modules so we can verify the factory wires them with
// the bound pool and retention values.
vi.mock('../../../../../src/runtime/vendor/pgvector/tool-memories.js', () => ({
  storeOperation: vi.fn(() => Promise.resolve('tm-1')),
  findSimilar: vi.fn(() => Promise.resolve([])),
  detectGaps: vi.fn(() => Promise.resolve([])),
  getClusters: vi.fn(() => Promise.resolve({ clusters: [], outliers: [] })),
  getStats: vi.fn(() => Promise.resolve([])),
  cleanupExpired: vi.fn(() => Promise.resolve(0))
}))
vi.mock('../../../../../src/runtime/vendor/pgvector/analysis-memories.js', () => ({
  storeMemory: vi.fn(() => Promise.resolve('am-1')),
  recallMemories: vi.fn(() => Promise.resolve([])),
  clearMemories: vi.fn(() => Promise.resolve(0)),
  cleanupExpired: vi.fn(() => Promise.resolve(0))
}))
vi.mock('../../../../../src/runtime/vendor/pgvector/ingested-records.js', () => ({
  storeRecords: vi.fn(() => Promise.resolve(0)),
  queryRecords: vi.fn(() => Promise.resolve([])),
  getEmbeddingsForRecords: vi.fn(() => Promise.resolve(new Map())),
  getRecordsWithoutEmbeddings: vi.fn(() => Promise.resolve([])),
  updateRecordEmbeddings: vi.fn(() => Promise.resolve(0)),
  getSessionGraphInfo: vi.fn(() =>
    Promise.resolve({ edgeTypes: [], embeddedRecordCount: 0, totalRecordCount: 0 })
  ),
  describeSession: vi.fn(() => Promise.resolve(null)),
  getRecordCount: vi.fn(() => Promise.resolve(0)),
  getRecordIds: vi.fn(() => Promise.resolve([])),
  getRecordIdsFiltered: vi.fn(() => Promise.resolve([])),
  getRecordsForDryRun: vi.fn(() =>
    Promise.resolve({
      matchedCount: 0,
      sampleIds: [],
      sampleData: [],
      earliestIngestedAt: null,
      latestIngestedAt: null
    })
  ),
  clearRecords: vi.fn(() => Promise.resolve(0)),
  cleanupExpired: vi.fn(() => Promise.resolve(0))
}))
vi.mock('../../../../../src/runtime/vendor/pgvector/ingested-edges.js', () => ({
  storeEdges: vi.fn(() => Promise.resolve(0)),
  getEdgesFrom: vi.fn(() => Promise.resolve([])),
  getEdgesForSources: vi.fn(() => Promise.resolve([])),
  clearEdges: vi.fn(() => Promise.resolve(0)),
  cleanupExpired: vi.fn(() => Promise.resolve(0))
}))

import * as analysisMemories from '../../../../../src/runtime/vendor/pgvector/analysis-memories.js'
import { createPgvectorAdapter } from '../../../../../src/runtime/vendor/pgvector/index.js'
import * as ingestedEdges from '../../../../../src/runtime/vendor/pgvector/ingested-edges.js'
import * as ingestedRecords from '../../../../../src/runtime/vendor/pgvector/ingested-records.js'
import * as toolMemories from '../../../../../src/runtime/vendor/pgvector/tool-memories.js'

describe('lib/services/vendor/pgvector/index — createPgvectorAdapter', () => {
  const mockPool = { query: vi.fn(), connect: vi.fn() } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an adapter exposing the four sub-adapters', () => {
    const adapter = createPgvectorAdapter({ pool: mockPool })

    expect(adapter.toolMemories).toBeDefined()
    expect(adapter.analysisMemories).toBeDefined()
    expect(adapter.ingestedRecords).toBeDefined()
    expect(adapter.ingestedEdges).toBeDefined()
    expect(typeof adapter.flush).toBe('function')
    expect(typeof adapter.close).toBe('function')
  })

  describe('toolMemories wiring', () => {
    it('binds the pool and forwards method arguments', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })
      const embedding = new Float32Array(384).fill(0.1)

      await adapter.toolMemories.storeOperation(embedding, {
        toolName: 'create_model',
        summary: 'create_model deal'
      })

      expect(toolMemories.storeOperation).toHaveBeenCalledWith(mockPool, embedding, {
        toolName: 'create_model',
        summary: 'create_model deal'
      })
    })

    it('passes the configured retention window to cleanupExpired', async () => {
      const adapter = createPgvectorAdapter({
        pool: mockPool,
        toolMemoriesRetentionDays: 14
      })

      await adapter.toolMemories.cleanupExpired()

      expect(toolMemories.cleanupExpired).toHaveBeenCalledWith(mockPool, 14)
    })

    it('defaults toolMemoriesRetentionDays to 30', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })

      await adapter.toolMemories.cleanupExpired()

      expect(toolMemories.cleanupExpired).toHaveBeenCalledWith(mockPool, 30)
    })
  })

  describe('analysisMemories wiring', () => {
    it('binds the pool and forwards method arguments', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })
      const embedding = new Float32Array(384).fill(0.2)

      await adapter.analysisMemories.storeMemory(embedding, {
        analysisId: 'a1',
        finding: 'Test finding'
      })

      expect(analysisMemories.storeMemory).toHaveBeenCalledWith(mockPool, embedding, {
        analysisId: 'a1',
        finding: 'Test finding'
      })
    })

    it('forwards cleanupExpired with no extra args (row-level TTL)', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })

      await adapter.analysisMemories.cleanupExpired()

      expect(analysisMemories.cleanupExpired).toHaveBeenCalledWith(mockPool)
    })
  })

  describe('ingestedRecords wiring', () => {
    it('passes the configured retention window to storeRecords', async () => {
      const adapter = createPgvectorAdapter({
        pool: mockPool,
        ingestedRecordsRetentionDays: 14
      })

      await adapter.ingestedRecords.storeRecords({
        analysisId: 'a1',
        model: 'deal',
        records: [{ id: 'd-1', data: { id: 'd-1' } }]
      })

      expect(ingestedRecords.storeRecords).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({ analysisId: 'a1', model: 'deal' }),
        14
      )
    })

    it('defaults ingestedRecordsRetentionDays to 7', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })

      await adapter.ingestedRecords.storeRecords({
        analysisId: 'a1',
        model: 'deal',
        records: [{ id: 'd-1', data: { id: 'd-1' } }]
      })

      expect(ingestedRecords.storeRecords).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({ analysisId: 'a1' }),
        7
      )
    })

    it('forwards queryRecords with the bound pool', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })

      await adapter.ingestedRecords.queryRecords('a1', { mode: 'filter', where: { id: 'x' } })

      expect(ingestedRecords.queryRecords).toHaveBeenCalledWith(mockPool, 'a1', {
        mode: 'filter',
        where: { id: 'x' }
      })
    })
  })

  describe('ingestedEdges wiring', () => {
    it('passes the configured retention window to storeEdges', async () => {
      const adapter = createPgvectorAdapter({
        pool: mockPool,
        ingestedEdgesRetentionDays: 3
      })

      await adapter.ingestedEdges.storeEdges({
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
      })

      expect(ingestedEdges.storeEdges).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({ analysisId: 'a1' }),
        3
      )
    })

    it('falls back to ingestedRecordsRetentionDays when ingestedEdgesRetentionDays is unset', async () => {
      const adapter = createPgvectorAdapter({
        pool: mockPool,
        ingestedRecordsRetentionDays: 9
      })

      await adapter.ingestedEdges.storeEdges({
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
      })

      expect(ingestedEdges.storeEdges).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({ analysisId: 'a1' }),
        9
      )
    })
  })

  describe('lifecycle', () => {
    it('flush is a no-op (pg pool has no flush concept)', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })
      await expect(adapter.flush(1000)).resolves.toBeUndefined()
    })

    it('close is a no-op (pool lifecycle owned by integrator)', async () => {
      const adapter = createPgvectorAdapter({ pool: mockPool })
      await expect(adapter.close(1000)).resolves.toBeUndefined()
    })
  })
})
