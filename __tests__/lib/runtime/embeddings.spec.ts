// Mock logger to prevent console output during tests
vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Mock @huggingface/transformers
const mockPipeline = vi.fn()
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(() => mockPipeline)
}))

import {
  embed,
  embedBatch,
  getEmbeddingDimensions,
  initEmbeddings
} from '../../../src/runtime/embeddings.js'

describe('lib/services/embeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Shape the mock output like the real batched pipeline: one flat
    // Float32Array of length n*384 plus dims [n, 384].
    mockPipeline.mockImplementation((input: string | string[]) => {
      const n = Array.isArray(input) ? input.length : 1
      return Promise.resolve({ data: new Float32Array(n * 384).fill(0.1), dims: [n, 384] })
    })
  })

  describe('getEmbeddingDimensions', () => {
    it('should return 384', () => {
      expect(getEmbeddingDimensions()).toBe(384)
    })
  })

  describe('embed', () => {
    it('should return a Float32Array', async () => {
      const result = await embed('test text')

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(384)
    })

    it('should call pipeline with correct parameters', async () => {
      await embed('hello world')

      expect(mockPipeline).toHaveBeenCalledWith('hello world', {
        pooling: 'mean',
        normalize: true
      })
    })
  })

  describe('embedBatch', () => {
    it('should return array of Float32Arrays', async () => {
      const results = await embedBatch(['text1', 'text2'])

      expect(results).toHaveLength(2)
      expect(results[0]).toBeInstanceOf(Float32Array)
      expect(results[0]).toHaveLength(384)
      expect(results[1]).toBeInstanceOf(Float32Array)
      expect(results[1]).toHaveLength(384)
    })

    it('embeds the whole batch in a single forward pass', async () => {
      await embedBatch(['a', 'b', 'c'])

      expect(mockPipeline).toHaveBeenCalledTimes(1)
      expect(mockPipeline).toHaveBeenCalledWith(['a', 'b', 'c'], {
        pooling: 'mean',
        normalize: true
      })
    })

    it('returns [] without invoking the model for an empty batch', async () => {
      const results = await embedBatch([])
      expect(results).toEqual([])
      expect(mockPipeline).not.toHaveBeenCalled()
    })

    it('throws on a model/schema dimension mismatch', async () => {
      mockPipeline.mockResolvedValueOnce({ data: new Float32Array(512), dims: [1, 512] })
      await expect(embedBatch(['x'])).rejects.toThrow(/512-dim vectors but the schema expects 384/)
    })
  })

  describe('initEmbeddings', () => {
    it('should pre-warm the model without error', async () => {
      await expect(initEmbeddings()).resolves.not.toThrow()
    })
  })
})
