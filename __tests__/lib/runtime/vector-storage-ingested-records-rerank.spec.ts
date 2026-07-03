import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/runtime/embeddings.js', () => ({
  embedBatch: vi.fn((texts: string[]) =>
    Promise.resolve(texts.map(() => new Float32Array(384).fill(0.1)))
  )
}))

vi.mock('../../../src/runtime/reranking.js', () => ({
  rerank: vi.fn()
}))

vi.mock('../../../src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

import { rerank } from '../../../src/runtime/reranking.js'
import type { VectorStorageAdapter } from '../../../src/runtime/vector-storage-definitions.js'
import { searchIngestedRecords } from '../../../src/runtime/vector-storage-ingested-records.js'
import {
  closeVectorStorage,
  initVectorStorage
} from '../../../src/runtime/vector-storage-lifecycle.js'

const searchRecordsSemantic = vi.fn()

function installAdapter(): void {
  const adapter = {
    ingestedRecords: { searchRecordsSemantic },
    close: vi.fn(() => Promise.resolve())
  } as unknown as VectorStorageAdapter
  initVectorStorage({ adapter })
}

describe('lib/runtime/vector-storage-ingested-records — reranking (ADR 0018)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeVectorStorage()
    installAdapter()
  })

  it('over-fetches, reranks the pool, and cuts to topK', async () => {
    // Cosine returns 6 candidates (topK 2 * overFetch 3), worst-relevant first.
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((t, i) => ({
      record: { id: String(i), title: t },
      similarity: 1 - i * 0.1
    }))
    searchRecordsSemantic.mockResolvedValue(pool)
    // Cross-encoder prefers the LAST two candidates (reverse of cosine).
    ;(rerank as ReturnType<typeof vi.fn>).mockResolvedValue([1, 2, 3, 4, 5, 6])

    const hits = await searchIngestedRecords('s', 'query', {
      rerank: true,
      topK: 2,
      overFetch: 3
    })

    // Over-fetched 6 (2 * 3).
    expect(searchRecordsSemantic.mock.calls[0][2]).toMatchObject({ topK: 6, rerank: false })
    // Reranked: highest cross-encoder scores are candidates 5 and 4 (records f, e).
    expect(hits.map((h) => h.record.title)).toEqual(['f', 'e'])
  })

  it('falls back to cosine order when the reranker is unavailable', async () => {
    const pool = [
      { record: { id: '1', title: 'x' }, similarity: 0.9 },
      { record: { id: '2', title: 'y' }, similarity: 0.8 }
    ]
    searchRecordsSemantic.mockResolvedValue(pool)
    ;(rerank as ReturnType<typeof vi.fn>).mockResolvedValue([]) // unavailable

    const hits = await searchIngestedRecords('s', 'query', { rerank: true, topK: 2 })

    expect(hits.map((h) => h.record.title)).toEqual(['x', 'y'])
  })

  it('does not rerank when the flag is off (single cosine call, no over-fetch)', async () => {
    searchRecordsSemantic.mockResolvedValue([])
    await searchIngestedRecords('s', 'query', { topK: 5 })

    expect(searchRecordsSemantic).toHaveBeenCalledTimes(1)
    expect(searchRecordsSemantic.mock.calls[0][2]).toMatchObject({ topK: 5 })
    expect(rerank).not.toHaveBeenCalled()
  })
})
