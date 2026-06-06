import { cosineSimilarity } from '../../../src/runtime/cosine-similarity.js'

describe('lib/services/cosine-similarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const vec = [1, 0, 0]
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0)
  })

  it('should return 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
  })

  it('should return -1.0 for opposite vectors', () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0)
  })

  it('should return 0 for zero vectors', () => {
    const zero = [0, 0, 0]
    const vec = [1, 2, 3]
    expect(cosineSimilarity(zero, vec)).toBe(0)
    expect(cosineSimilarity(vec, zero)).toBe(0)
    expect(cosineSimilarity(zero, zero)).toBe(0)
  })

  it('should accept Float32Array inputs', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
  })

  it('should accept JSON string inputs', () => {
    const a = '[1,0,0]'
    const b = '[0,1,0]'
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
  })

  it('should accept mixed input types', () => {
    const a = new Float32Array([1, 0, 0])
    const b = '[1,0,0]'
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
  })

  it('should handle non-unit vectors correctly', () => {
    const a = [3, 4]
    const b = [6, 8]
    // Same direction, different magnitudes — cosine = 1.0
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
  })
})
