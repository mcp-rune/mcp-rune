import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

// Mock @huggingface/transformers with a cross-encoder that scores each
// (query, document) pair. We make the score depend on the document text so
// reordering is observable.
const mockReranker = vi.fn()
const transformersMock = vi.hoisted(() => ({ available: true }))
vi.mock('@huggingface/transformers', () => {
  if (!transformersMock.available) throw new Error('module not found')
  return { pipeline: vi.fn(() => mockReranker) }
})

import { isRerankingAvailable, rerank } from '../../../src/runtime/reranking.js'

describe('lib/runtime/reranking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transformersMock.available = true
    // Score = length of the document text — deterministic and doc-dependent.
    mockReranker.mockImplementation((pairs: Array<{ text: string; text_pair: string }>) =>
      Promise.resolve(pairs.map((p) => ({ label: 'LABEL_1', score: p.text_pair.length })))
    )
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns one score per document, in input order', async () => {
    const scores = await rerank('query', ['aa', 'bbbb', 'c'])
    expect(scores).toEqual([2, 4, 1])
  })

  it('passes the query as text and each document as text_pair', async () => {
    await rerank('find me', ['doc one'])
    expect(mockReranker).toHaveBeenCalledWith([{ text: 'find me', text_pair: 'doc one' }])
  })

  it('returns [] for an empty document list without invoking the model', async () => {
    const scores = await rerank('query', [])
    expect(scores).toEqual([])
    expect(mockReranker).not.toHaveBeenCalled()
  })

  it('reports availability when transformers is installed', async () => {
    expect(await isRerankingAvailable()).toBe(true)
  })
})
