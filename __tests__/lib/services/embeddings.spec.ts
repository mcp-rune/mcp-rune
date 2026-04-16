// Mock logger to prevent console output during tests
vi.mock('#src/services/logger.js', () => ({
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
} from '../../../src/services/embeddings.js'

describe('lib/services/embeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.mockResolvedValue({
      data: new Float32Array(384).fill(0.1)
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
      expect(results[1]).toBeInstanceOf(Float32Array)
    })

    it('should call pipeline for each text', async () => {
      await embedBatch(['a', 'b', 'c'])

      expect(mockPipeline).toHaveBeenCalledTimes(3)
    })
  })

  describe('initEmbeddings', () => {
    it('should pre-warm the model without error', async () => {
      await expect(initEmbeddings()).resolves.not.toThrow()
    })
  })
})
