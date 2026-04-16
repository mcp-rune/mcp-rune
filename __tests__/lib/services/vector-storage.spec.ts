// Mock the vendor module
vi.mock('../../../src/services/vendor/pgvector/index.js', () => ({
  initialize: vi.fn(() => true),
  isConfigured: vi.fn(() => true),
  getPool: vi.fn(() => ({})),
  flush: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve())
}))

// Mock the operations module
vi.mock('../../../src/services/vendor/pgvector/tool-memories.js', () => ({
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
  getStats: vi.fn(() => Promise.resolve([]))
}))

// Mock the analysis memories module
vi.mock('../../../src/services/vendor/pgvector/analysis-memories.js', () => ({
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
  clearMemories: vi.fn(() => Promise.resolve(3))
}))

// Mock the embeddings module
vi.mock('../../../src/services/embeddings.js', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array(384).fill(0.1))),
  embedBatch: vi.fn((texts) => Promise.resolve(texts.map(() => new Float32Array(384).fill(0.1))))
}))

// Mock the tool output adapters module
vi.mock('../../../src/services/tool-output-adapters.js', () => ({
  adaptToolOutput: vi.fn(() => null)
}))

import { embed, embedBatch } from '../../../src/services/embeddings.js'
import { adaptToolOutput } from '../../../src/services/tool-output-adapters.js'
import {
  clearAnalysisMemories,
  closeVectorStorage,
  detectOperationGaps,
  findSimilarOperations,
  flushVectorStorage,
  getOperationClusters,
  getOperationStats,
  initVectorStorage,
  isVectorStorageEnabled,
  recallAnalysisMemories,
  storeAnalysisMemory,
  storeOperation
} from '../../../src/services/vector-storage.js'
import * as analysisMemories from '../../../src/services/vendor/pgvector/analysis-memories.js'
import * as vendor from '../../../src/services/vendor/pgvector/index.js'
import * as operations from '../../../src/services/vendor/pgvector/tool-memories.js'

describe('lib/services/vector-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendor.isConfigured.mockReturnValue(true)
    vendor.getPool.mockReturnValue({})
  })

  describe('initVectorStorage', () => {
    it('should delegate to vendor.initialize', () => {
      const options = { serviceName: 'test', version: '1.0.0', retentionDays: 30 }
      const result = initVectorStorage(options)

      expect(vendor.initialize).toHaveBeenCalledWith(options)
      expect(result).toBe(true)
    })
  })

  describe('isVectorStorageEnabled', () => {
    it('should delegate to vendor.isConfigured', () => {
      const result = isVectorStorageEnabled()

      expect(vendor.isConfigured).toHaveBeenCalled()
      expect(result).toBe(true)
    })
  })

  describe('storeOperation', () => {
    it('should embed summary and store with metadata', async () => {
      const result = await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal', attributes: { name: 'BBC Drama', right_type: 'catchup' } },
        sessionId: 'session-1'
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining('create_model deal'))
      expect(operations.storeOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Float32Array),
        expect.objectContaining({
          toolName: 'create_model',
          toolArgs: { model: 'deal', attributes: { name: 'BBC Drama', right_type: 'catchup' } },
          sessionId: 'session-1'
        })
      )
      expect(result).toBe('uuid-123')
    })

    it('should return null when memory storage is disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const result = await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal' }
      })

      expect(result).toBeNull()
      expect(embed).not.toHaveBeenCalled()
    })

    it('should return null when pool is not available', async () => {
      vendor.getPool.mockReturnValue(null)

      const result = await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal' }
      })

      expect(result).toBeNull()
    })

    it('should pass toolOutput through adapter and to vendor', async () => {
      const adaptedOutput = { id: '999', name: 'Adapted' }
      adaptToolOutput.mockReturnValue(adaptedOutput)

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
      expect(operations.storeOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Float32Array),
        expect.objectContaining({ toolOutput: adaptedOutput })
      )
    })

    it('should pass null toolOutput when adapter returns null', async () => {
      adaptToolOutput.mockReturnValue(null)

      await storeOperation({
        toolName: 'delete_model',
        toolArgs: { model: 'deal', id: '123' }
      })

      expect(operations.storeOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Float32Array),
        expect.objectContaining({ toolOutput: null })
      )
    })
  })

  describe('findSimilarOperations', () => {
    it('should embed query and search', async () => {
      const results = await findSimilarOperations('deals for BBC', { toolName: 'create_model' })

      expect(embed).toHaveBeenCalledWith('deals for BBC')
      expect(operations.findSimilar).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Float32Array),
        { toolName: 'create_model' },
        {}
      )
      expect(results).toHaveLength(1)
    })

    it('should return empty array when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const results = await findSimilarOperations('test query')

      expect(results).toEqual([])
      expect(embed).not.toHaveBeenCalled()
    })
  })

  describe('detectOperationGaps', () => {
    it('should embed steps and detect gaps', async () => {
      const steps = ['Create deal', 'Set platforms', 'Activate deal']
      const gaps = await detectOperationGaps(steps, {
        recordId: '123',
        modelName: 'deal'
      })

      expect(embedBatch).toHaveBeenCalledWith(steps)
      expect(operations.detectGaps).toHaveBeenCalled()
      expect(gaps).toHaveLength(1)
    })

    it('should return empty array when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const gaps = await detectOperationGaps(['step'], {})

      expect(gaps).toEqual([])
    })
  })

  describe('getOperationClusters', () => {
    it('should delegate to operations.getClusters', async () => {
      const result = await getOperationClusters({ days: 7 })

      expect(operations.getClusters).toHaveBeenCalledWith(expect.anything(), { days: 7 }, {})
      expect(result).toEqual({ clusters: [], outliers: [] })
    })

    it('should return empty result when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const result = await getOperationClusters()

      expect(result).toEqual({ clusters: [], outliers: [] })
    })
  })

  describe('getOperationStats', () => {
    it('should delegate to operations.getStats', async () => {
      await getOperationStats({ days: 14 })

      expect(operations.getStats).toHaveBeenCalledWith(expect.anything(), { days: 14 })
    })

    it('should return empty array when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const result = await getOperationStats()

      expect(result).toEqual([])
    })
  })

  describe('lifecycle methods', () => {
    it('should delegate flushVectorStorage to vendor.flush', async () => {
      await flushVectorStorage(3000)

      expect(vendor.flush).toHaveBeenCalledWith(3000)
    })

    it('should use default timeout for flush', async () => {
      await flushVectorStorage()

      expect(vendor.flush).toHaveBeenCalledWith(5000)
    })

    it('should delegate closeVectorStorage to vendor.close', async () => {
      await closeVectorStorage(10000)

      expect(vendor.close).toHaveBeenCalledWith(10000)
    })

    it('should use default timeout for close', async () => {
      await closeVectorStorage()

      expect(vendor.close).toHaveBeenCalledWith(5000)
    })
  })

  describe('storeAnalysisMemory', () => {
    it('should embed finding and store with metadata', async () => {
      const result = await storeAnalysisMemory({
        analysisId: 'analysis-1',
        finding: 'Pattern detected in deal creation',
        category: 'patterns',
        persistent: true
      })

      expect(embed).toHaveBeenCalledWith('Pattern detected in deal creation')
      expect(analysisMemories.storeMemory).toHaveBeenCalledWith(
        expect.anything(),
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

    it('should return null when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const result = await storeAnalysisMemory({
        analysisId: 'analysis-1',
        finding: 'test'
      })

      expect(result).toBeNull()
      expect(embed).not.toHaveBeenCalled()
    })

    it('should return null when pool is not available', async () => {
      vendor.getPool.mockReturnValue(null)

      const result = await storeAnalysisMemory({
        analysisId: 'analysis-1',
        finding: 'test'
      })

      expect(result).toBeNull()
    })
  })

  describe('recallAnalysisMemories', () => {
    it('should recall by analysis ID without embedding', async () => {
      const results = await recallAnalysisMemories({ analysisId: 'analysis-1' })

      expect(embed).not.toHaveBeenCalled()
      expect(analysisMemories.recallMemories).toHaveBeenCalledWith(
        expect.anything(),
        { analysisId: 'analysis-1' },
        {}
      )
      expect(results).toHaveLength(1)
    })

    it('should embed query for semantic recall', async () => {
      await recallAnalysisMemories({ query: 'deal patterns', category: 'patterns' })

      expect(embed).toHaveBeenCalledWith('deal patterns')
      expect(analysisMemories.recallMemories).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          embedding: expect.any(Float32Array),
          category: 'patterns'
        }),
        {}
      )
      // query should be removed from filters
      const callFilters = analysisMemories.recallMemories.mock.calls[0][1]
      expect(callFilters.query).toBeUndefined()
    })

    it('should return empty array when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const results = await recallAnalysisMemories({ analysisId: 'analysis-1' })

      expect(results).toEqual([])
    })
  })

  describe('clearAnalysisMemories', () => {
    it('should delegate to analysisMemories.clearMemories', async () => {
      const result = await clearAnalysisMemories('analysis-1')

      expect(analysisMemories.clearMemories).toHaveBeenCalledWith(expect.anything(), 'analysis-1')
      expect(result).toBe(3)
    })

    it('should return 0 when disabled', async () => {
      vendor.isConfigured.mockReturnValue(false)

      const result = await clearAnalysisMemories('analysis-1')

      expect(result).toBe(0)
    })

    it('should return 0 when pool is not available', async () => {
      vendor.getPool.mockReturnValue(null)

      const result = await clearAnalysisMemories('analysis-1')

      expect(result).toBe(0)
    })
  })

  describe('operationToText (via storeOperation)', () => {
    it('should generate create_model summary with fields', async () => {
      adaptToolOutput.mockReturnValue(null)

      await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'brand', attributes: { name: 'Test Brand', status: 'active' } }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining("create_model brand 'Test Brand'"))
    })

    it('should append -> id: suffix for create_model when toolOutput has id', async () => {
      adaptToolOutput.mockReturnValue({ id: 'new-id-999' })

      await storeOperation({
        toolName: 'create_model',
        toolArgs: { model: 'deal', attributes: { name: 'BBC' } },
        toolOutput: { id: 'new-id-999', name: 'BBC' }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining('-> id: new-id-999'))
    })

    it('should generate update_model summary', async () => {
      await storeOperation({
        toolName: 'update_model',
        toolArgs: { model: 'deal', id: '123', attributes: { status: 'active', end_offset: 14 } }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining("update_model deal '123'"))
    })

    it('should generate delete_model summary', async () => {
      await storeOperation({
        toolName: 'delete_model',
        toolArgs: { model: 'rule', id: '456' }
      })

      expect(embed).toHaveBeenCalledWith(expect.stringContaining("delete_model rule '456'"))
    })

    it('should generate generic summary for unknown tools', async () => {
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
