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

import { embed, embedBatch } from '../../../src/runtime/embeddings.js'
import { adaptToolOutput } from '../../../src/runtime/tool-output-adapters.js'
import type { VectorStorageAdapter } from '../../../src/runtime/vector-storage-definitions.js'
import {
  closeVectorStorage,
  initVectorStorage
} from '../../../src/runtime/vector-storage-lifecycle.js'
import {
  detectOperationGaps,
  findSimilarOperations,
  getOperationClusters,
  getOperationStats,
  storeOperation
} from '../../../src/runtime/vector-storage-tool-memories.js'

function makeMockAdapter(): VectorStorageAdapter {
  return {
    toolMemories: {
      storeOperation: vi.fn(() => Promise.resolve('uuid-123')),
      findSimilar: vi.fn(() =>
        Promise.resolve([
          {
            id: '1',
            similarity: 0.9,
            summary: 'create_model deal',
            tool_name: 'create_model',
            tool_args: { model: 'deal' }
          }
        ])
      ),
      detectGaps: vi.fn(() =>
        Promise.resolve([{ step: 'Set platforms', confidence: 0.2, status: 'missing' }])
      ),
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

describe('lib/runtime/vector-storage-tool-memories', () => {
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

  describe('storeOperation', () => {
    it('embeds the summary and delegates to the toolMemories adapter', async () => {
      const result = await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal', attributes: { name: 'BBC Drama', right_type: 'catchup' } },
        sessionId: 'session-1'
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining('create_model deal'))
      expect(adapter.toolMemories.storeOperation).toHaveBeenCalledWith(
        expect.any(Float32Array),
        expect.objectContaining({
          toolName: 'create_model',
          toolArgs: { model: 'deal', attributes: { name: 'BBC Drama', right_type: 'catchup' } },
          sessionId: 'session-1'
        })
      )
      expect(result).toBe('uuid-123')
    })

    it('returns null when vector storage is disabled', async () => {
      await closeVectorStorage()

      const result = await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal' }
      })

      expect(result).toBeNull()
      expect(embed).not.toHaveBeenCalled()
    })

    it('passes adapted toolOutput through to the adapter', async () => {
      const adaptedOutput = { id: '999', name: 'Adapted' }
      ;(adaptToolOutput as ReturnType<typeof vi.fn>).mockReturnValue(adaptedOutput)

      await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal' },
        toolOutput: { id: '999', name: 'Adapted', extra: 'ignored' }
      })

      expect(adaptToolOutput).toHaveBeenCalledWith(
        'create_model',
        { id: '999', name: 'Adapted', extra: 'ignored' },
        { model: 'deal' }
      )
      expect(adapter.toolMemories.storeOperation).toHaveBeenCalledWith(
        expect.any(Float32Array),
        expect.objectContaining({ toolOutput: adaptedOutput })
      )
    })

    it('passes null toolOutput when the adapter returns null', async () => {
      ;(adaptToolOutput as ReturnType<typeof vi.fn>).mockReturnValue(null)

      await storeOperation({
        toolName: 'delete_model',
        toolArgs: { model: 'deal', id: '123' }
      })

      expect(adapter.toolMemories.storeOperation).toHaveBeenCalledWith(
        expect.any(Float32Array),
        expect.objectContaining({ toolOutput: null })
      )
    })
  })

  describe('findSimilarOperations', () => {
    it('embeds the query and delegates to findSimilar', async () => {
      const results = await findSimilarOperations('deals for BBC', { toolName: 'create_model' })

      expect(embed).toHaveBeenCalledWith('deals for BBC')
      expect(adapter.toolMemories.findSimilar).toHaveBeenCalledWith(
        expect.any(Float32Array),
        { toolName: 'create_model' },
        {}
      )
      expect(results).toHaveLength(1)
    })

    it('returns empty array when disabled', async () => {
      await closeVectorStorage()

      const results = await findSimilarOperations('test query')

      expect(results).toEqual([])
      expect(embed).not.toHaveBeenCalled()
    })
  })

  describe('detectOperationGaps', () => {
    it('batch-embeds steps and delegates to detectGaps', async () => {
      const steps = ['Create deal', 'Set platforms', 'Activate deal']
      const gaps = await detectOperationGaps(steps, { recordId: '123', modelName: 'deal' })

      expect(embedBatch).toHaveBeenCalledWith(steps)
      expect(adapter.toolMemories.detectGaps).toHaveBeenCalled()
      expect(gaps).toHaveLength(1)
    })

    it('returns empty array when disabled', async () => {
      await closeVectorStorage()

      const gaps = await detectOperationGaps(['step'], {})

      expect(gaps).toEqual([])
    })
  })

  describe('getOperationClusters', () => {
    it('delegates to the toolMemories adapter', async () => {
      const result = await getOperationClusters({ days: 7 })

      expect(adapter.toolMemories.getClusters).toHaveBeenCalledWith({ days: 7 }, {})
      expect(result).toEqual({ clusters: [], outliers: [] })
    })

    it('returns an empty result when disabled', async () => {
      await closeVectorStorage()

      const result = await getOperationClusters()

      expect(result).toEqual({ clusters: [], outliers: [] })
    })
  })

  describe('getOperationStats', () => {
    it('delegates to the toolMemories adapter', async () => {
      await getOperationStats({ days: 14 })

      expect(adapter.toolMemories.getStats).toHaveBeenCalledWith({ days: 14 })
    })

    it('returns an empty array when disabled', async () => {
      await closeVectorStorage()

      const result = await getOperationStats()

      expect(result).toEqual([])
    })
  })

  describe('operationToText (via storeOperation)', () => {
    it('generates a create_model summary with fields', async () => {
      ;(adaptToolOutput as ReturnType<typeof vi.fn>).mockReturnValue(null)

      await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'brand', attributes: { name: 'Test Brand', status: 'active' } }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining("create_model brand 'Test Brand'"))
    })

    it('appends -> id: suffix when toolOutput has an id', async () => {
      ;(adaptToolOutput as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'new-id-999' })

      await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal', attributes: { name: 'BBC' } },
        toolOutput: { id: 'new-id-999', name: 'BBC' }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining('-> id: new-id-999'))
    })

    it('generates an update_model summary', async () => {
      await storeOperation({
        toolName: 'update_model',
        toolArgs: { model: 'deal', id: '123', attributes: { status: 'active', end_offset: 14 } }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining("update_model deal '123'"))
    })

    it('generates a delete_model summary', async () => {
      await storeOperation({
        toolName: 'delete_model',
        toolArgs: { model: 'rule', id: '456' }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining("delete_model rule '456'"))
    })

    it('generates a generic summary for unknown tools', async () => {
      await storeOperation({
        toolName: 'find_similar_operations',
        toolArgs: { query: 'test' }
      })

      expect(embed).toHaveBeenCalledWith(
        expect.stringContaining('find_similar_operations with args:')
      )
    })
  })
})
