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

import {
  closeVectorStorage,
  flushVectorStorage,
  initVectorStorage,
  isVectorStorageEnabled,
  type VectorStorageAdapter
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
      recallMemories: vi.fn(() => Promise.resolve([])),
      clearMemories: vi.fn(() => Promise.resolve(0)),
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

describe('lib/runtime/vector-storage-lifecycle', () => {
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

  describe('initVectorStorage', () => {
    it('enables vector storage when an adapter is provided', () => {
      expect(isVectorStorageEnabled()).toBe(true)
    })

    it('returns false and stays disabled without an adapter', async () => {
      await closeVectorStorage()
      const result = initVectorStorage({})
      expect(result).toBe(false)
      expect(isVectorStorageEnabled()).toBe(false)
    })

    it('runs a boot-time cleanup sweep across every sub-adapter', async () => {
      await closeVectorStorage()
      const freshAdapter = makeMockAdapter()
      initVectorStorage({ adapter: freshAdapter })

      await vi.waitFor(() => {
        expect(freshAdapter.toolMemories.cleanupExpired).toHaveBeenCalled()
        expect(freshAdapter.analysisMemories.cleanupExpired).toHaveBeenCalled()
        expect(freshAdapter.ingestedRecords.cleanupExpired).toHaveBeenCalled()
        expect(freshAdapter.ingestedEdges.cleanupExpired).toHaveBeenCalled()
      })
    })
  })

  describe('background cleanup interval', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(async () => {
      vi.useRealTimers()
      await closeVectorStorage()
    })

    it('does not schedule an interval by default', async () => {
      await closeVectorStorage()
      const freshAdapter = makeMockAdapter()
      initVectorStorage({ adapter: freshAdapter })

      await vi.waitFor(() => {
        expect(freshAdapter.toolMemories.cleanupExpired).toHaveBeenCalledTimes(1)
      })
      const before = (freshAdapter.toolMemories.cleanupExpired as ReturnType<typeof vi.fn>).mock
        .calls.length

      vi.advanceTimersByTime(60_000)

      expect(
        (freshAdapter.toolMemories.cleanupExpired as ReturnType<typeof vi.fn>).mock.calls.length
      ).toBe(before)
    })

    it('fires periodic sweeps when backgroundCleanupIntervalMs is set', async () => {
      await closeVectorStorage()
      const freshAdapter = makeMockAdapter()
      initVectorStorage({ adapter: freshAdapter, backgroundCleanupIntervalMs: 5_000 })

      await vi.waitFor(() => {
        expect(freshAdapter.ingestedRecords.cleanupExpired).toHaveBeenCalledTimes(1)
      })

      vi.advanceTimersByTime(5_000)
      await vi.waitFor(() => {
        expect(freshAdapter.ingestedRecords.cleanupExpired).toHaveBeenCalledTimes(2)
      })

      vi.advanceTimersByTime(5_000)
      await vi.waitFor(() => {
        expect(freshAdapter.ingestedRecords.cleanupExpired).toHaveBeenCalledTimes(3)
      })
    })

    it('closeVectorStorage clears the interval', async () => {
      await closeVectorStorage()
      const freshAdapter = makeMockAdapter()
      initVectorStorage({ adapter: freshAdapter, backgroundCleanupIntervalMs: 5_000 })

      await vi.waitFor(() => {
        expect(freshAdapter.ingestedRecords.cleanupExpired).toHaveBeenCalledTimes(1)
      })

      await closeVectorStorage()
      const before = (freshAdapter.ingestedRecords.cleanupExpired as ReturnType<typeof vi.fn>).mock
        .calls.length

      vi.advanceTimersByTime(15_000)
      expect(
        (freshAdapter.ingestedRecords.cleanupExpired as ReturnType<typeof vi.fn>).mock.calls.length
      ).toBe(before)
    })
  })

  describe('isVectorStorageEnabled', () => {
    it('reflects whether an adapter is currently bound', async () => {
      expect(isVectorStorageEnabled()).toBe(true)
      await closeVectorStorage()
      expect(isVectorStorageEnabled()).toBe(false)
    })
  })

  describe('flushVectorStorage', () => {
    it('delegates to adapter.flush with given timeout', async () => {
      await flushVectorStorage(3000)
      expect(adapter.flush).toHaveBeenCalledWith(3000)
    })

    it('uses a default timeout of 5000ms', async () => {
      await flushVectorStorage()
      expect(adapter.flush).toHaveBeenCalledWith(5000)
    })
  })

  describe('closeVectorStorage', () => {
    it('delegates to adapter.close with given timeout', async () => {
      await closeVectorStorage(10000)
      expect(adapter.close).toHaveBeenCalledWith(10000)
    })

    it('uses a default timeout of 5000ms', async () => {
      await closeVectorStorage()
      expect(adapter.close).toHaveBeenCalledWith(5000)
    })
  })
})
