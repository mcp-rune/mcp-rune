/**
 * SemanticSearch - Embedding-based search over small datasets
 *
 * Composable utility for in-memory semantic search. Each registry
 * (knowledge, workflows, diagrams) gets its own instance.
 *
 * Uses the shared embedding service (MiniLM-L6-v2, 384 dims)
 * and cosine similarity for ranking.
 *
 * Graceful fallback: if not initialized, search() returns []
 * so callers can fall back to substring matching.
 */

import { embed, embedBatch } from '#src/services/embeddings.js'
import { cosineSimilarity } from '#src/services/cosine-similarity.js'

export interface SemanticSearchOptions {
  threshold?: number
  topK?: number
}

export interface ScoredResult<T> {
  item: T
  score: number
}

export class SemanticSearch {
  threshold: number
  topK: number
  private _items: unknown[] | null
  private _embeddings: Float32Array[] | null

  constructor({ threshold = 0.3, topK = 10 }: SemanticSearchOptions = {}) {
    this.threshold = threshold
    this.topK = topK
    this._items = null
    this._embeddings = null
  }

  /** Whether embeddings have been pre-computed */
  get isInitialized(): boolean {
    return this._embeddings !== null
  }

  /** Pre-compute embeddings for all items */
  async initialize<T>(items: T[], textFn: (item: T) => string): Promise<void> {
    if (items.length === 0) {
      this._items = []
      this._embeddings = []
      return
    }

    const texts = items.map(textFn)
    this._embeddings = await embedBatch(texts)
    this._items = items
  }

  /**
   * Search items by semantic similarity to a query
   *
   * @param query - Natural language search query
   * @param options - Override instance threshold/topK
   * @returns Ranked results
   */
  async search<T = unknown>(
    query: string,
    options: { threshold?: number; topK?: number } = {}
  ): Promise<ScoredResult<T>[]> {
    if (!this.isInitialized) return []

    const threshold = options.threshold ?? this.threshold
    const topK = options.topK ?? this.topK

    const queryEmbedding = await embed(query)

    const scored: ScoredResult<T>[] = []
    for (let i = 0; i < this._items!.length; i++) {
      const score = cosineSimilarity(queryEmbedding, this._embeddings![i]!)
      if (score >= threshold) {
        scored.push({ item: this._items![i] as T, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }
}
