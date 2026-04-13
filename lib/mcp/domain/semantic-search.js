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

import { embed, embedBatch } from '#lib/services/embeddings.js'
import { cosineSimilarity } from '#lib/services/cosine-similarity.js'

export class SemanticSearch {
  /**
   * @param {Object} [options]
   * @param {number} [options.threshold=0.3] - Minimum cosine similarity to include
   * @param {number} [options.topK=10] - Maximum results to return
   */
  constructor({ threshold = 0.3, topK = 10 } = {}) {
    this.threshold = threshold
    this.topK = topK
    this._items = null
    this._embeddings = null
  }

  /**
   * Whether embeddings have been pre-computed
   * @returns {boolean}
   */
  get isInitialized() {
    return this._embeddings !== null
  }

  /**
   * Pre-compute embeddings for all items
   *
   * @param {Array} items - Items to index
   * @param {Function} textFn - Extracts searchable text from an item
   * @returns {Promise<void>}
   */
  async initialize(items, textFn) {
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
   * @param {string} query - Natural language search query
   * @param {Object} [options]
   * @param {number} [options.threshold] - Override instance threshold
   * @param {number} [options.topK] - Override instance topK
   * @returns {Promise<Array<{ item: *, score: number }>>} Ranked results
   */
  async search(query, options = {}) {
    if (!this.isInitialized) return []

    const threshold = options.threshold ?? this.threshold
    const topK = options.topK ?? this.topK

    const queryEmbedding = await embed(query)

    const scored = []
    for (let i = 0; i < this._items.length; i++) {
      const score = cosineSimilarity(queryEmbedding, this._embeddings[i])
      if (score >= threshold) {
        scored.push({ item: this._items[i], score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }
}
