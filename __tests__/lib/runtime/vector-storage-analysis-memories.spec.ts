vi.mock('../../../src/runtime/embeddings.js', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array(384).fill(0.1))),
  embedBatch: vi.fn((texts) => Promise.resolve(texts.map(() => new Float32Array(384).fill(0.1))))
}))

vi.mock('../../../src/runtime/tool-output-adapters.js', () => ({
  adaptToolOutput: vi.fn(() => null)
}))

vi.mock('../../../src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

import { embed } from '../../../src/runtime/embeddings.js'
import {
  clearAnalysisMemories,
  recallAnalysisMemories,
  storeAnalysisMemory
} from '../../../src/runtime/vector-storage-analysis-memories.js'
import type { VectorStorageAdapter } from '../../../src/runtime/vector-storage-definitions.js'
import {
  closeVectorStorage,
  initVectorStorage
} from '../../../src/runtime/vector-storage-lifecycle.js'

function makeMockAdapter(): VectorStorageAdapter {
  return {
    toolMemories: {
      storeOperation: vi.fn(() => Promise.resolve('uuid-123')),
      findSimilar: vi.fn(() => Promise.resolve([])),
      detectGaps: vi.fn(() => Promise.resolve([])),
      getClusters: vi.fn(() => Promise.resolve({ clusters: [], outliers: [] })),
      getStats: vi.fn(() => Promise.resolve([])),
      cleanupExpired: vi.fn(() => Promise.resolve(0))
    },
    analysisMemories: {
      storeMemory: vi.fn(() => Promise.resolve('analysis-uuid-123')),
      recallMemories: vi.fn(() =>
        Promise.resolve([
          {
            id: 'a1',
            analysisId: 'analysis-1',
            finding: 'Test finding',
            createdAt: new Date()
          }
        ])
      ),
      clearMemories: vi.fn(() => Promise.resolve(3)),
      cleanupExpired: vi.fn(() => Promise.resolve(0))
    },
    ingestedRecords: {
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
    },
    ingestedEdges: {
      storeEdges: vi.fn(() => Promise.resolve(0)),
      getEdgesFrom: vi.fn(() => Promise.resolve([])),
      getEdgesForSources: vi.fn(() => Promise.resolve([])),
      clearEdges: vi.fn(() => Promise.resolve(0)),
      cleanupExpired: vi.fn(() => Promise.resolve(0))
    },
    flush: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve())
  }
}

describe('lib/runtime/vector-storage-analysis-memories', () => {
  let adapter: VectorStorageAdapter

  beforeEach(async () => {
    vi.clearAllMocks()
    await closeVectorStorage()
    adapter = makeMockAdapter()
    initVectorStorage({ adapter })
  })

  afterEach(async () => {
    await closeVectorStorage()
  })

  describe('storeAnalysisMemory', () => {
    it('embeds the finding and delegates to the adapter', async () => {
      const result = await storeAnalysisMemory({
        analysisId: 'analysis-1',
        finding: 'Pattern detected in deal creation',
        category: 'patterns',
        persistent: true
      })

      expect(embed).toHaveBeenCalledWith('Pattern detected in deal creation')
      expect(adapter.analysisMemories.storeMemory).toHaveBeenCalledWith(
        expect.any(Float32Array),
        expect.objectContaining({
          analysisId: 'analysis-1',
          finding: 'Pattern detected in deal creation',
          category: 'patterns',
          persistent: true
        })
      )
      expect(result).toBe('analysis-uuid-123')
    })

    it('returns null when disabled', async () => {
      await closeVectorStorage()

      const result = await storeAnalysisMemory({ analysisId: 'analysis-1', finding: 'test' })

      expect(result).toBeNull()
      expect(embed).not.toHaveBeenCalled()
    })
  })

  describe('recallAnalysisMemories', () => {
    it('recalls by analysis ID without embedding when no query is given', async () => {
      const results = await recallAnalysisMemories({ analysisId: 'analysis-1' })

      expect(embed).not.toHaveBeenCalled()
      expect(adapter.analysisMemories.recallMemories).toHaveBeenCalledWith(
        expect.objectContaining({ analysisId: 'analysis-1' }),
        {}
      )
      expect(results).toHaveLength(1)
    })

    it('embeds the query for semantic recall and replaces it with `embedding`', async () => {
      await recallAnalysisMemories({ query: 'deal patterns', category: 'patterns' })

      expect(embed).toHaveBeenCalledWith('deal patterns')
      expect(adapter.analysisMemories.recallMemories).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: expect.any(Float32Array),
          category: 'patterns'
        }),
        {}
      )

      const callFilters = (adapter.analysisMemories.recallMemories as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>
      expect(callFilters.query).toBeUndefined()
    })

    it('returns empty array when disabled', async () => {
      await closeVectorStorage()

      const results = await recallAnalysisMemories({ analysisId: 'analysis-1' })

      expect(results).toEqual([])
    })
  })

  describe('clearAnalysisMemories', () => {
    it('delegates to analysisMemories.clearMemories', async () => {
      const result = await clearAnalysisMemories('analysis-1')

      expect(adapter.analysisMemories.clearMemories).toHaveBeenCalledWith('analysis-1')
      expect(result).toBe(3)
    })

    it('returns 0 when disabled', async () => {
      await closeVectorStorage()

      const result = await clearAnalysisMemories('analysis-1')

      expect(result).toBe(0)
    })
  })
})
