/**
 * Domain Search Strategy - Configurable search adapter pattern
 *
 * Two strategies with a uniform async interface:
 * - SubstringSearch: case-insensitive substring matching (default, fast, no model loading)
 * - EmbeddingSearch: MiniLM embedding similarity with substring fallback
 *
 * Both implement:
 *   async initialize(items, textFn) — called once after items are assembled
 *   async search(query) → matching items array
 *
 * Factory: createDomainSearch(strategy) picks the right class.
 */

import { SemanticSearch } from './semantic-search.js'

/**
 * SubstringSearch — default for small datasets (<200 items)
 *
 * Case-insensitive match on name, title, description, and tags.
 * No model loading, resolves instantly.
 */
export class SubstringSearch {
  /**
   * @param {Array} [items] - Items to search (can also be set via initialize)
   */
  constructor(items) {
    this._items = items || []
  }

  /**
   * Store items for later search
   * @param {Array} items - Items to index
   * @param {Function} _textFn - Ignored (substring matches on item fields directly)
   */
  async initialize(items, _textFn) {
    this._items = items
  }

  /**
   * Case-insensitive substring search on name, title, description, tags
   * @param {string} query
   * @returns {Promise<Array>} Matching items
   */
  async search(query) {
    const q = query.toLowerCase()
    return this._items.filter(
      (item) =>
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.tags && item.tags.some((t) => t.toLowerCase().includes(q)))
    )
  }
}

/**
 * EmbeddingSearch — for larger datasets (200+ items)
 *
 * Wraps SemanticSearch with SubstringSearch as fallback.
 * Computes MiniLM embeddings during initialize(), then uses
 * cosine similarity for ranking. Falls back to substring if
 * no embedding results match.
 */
export class EmbeddingSearch {
  /**
   * @param {Object} [options]
   * @param {number} [options.threshold=0.3] - Minimum cosine similarity
   * @param {number} [options.topK=10] - Maximum results
   */
  constructor(options = {}) {
    this._semantic = new SemanticSearch(options)
    this._substring = new SubstringSearch()
  }

  /**
   * Compute embeddings for all items and store for substring fallback
   * @param {Array} items - Items to index
   * @param {Function} textFn - Extracts searchable text from an item
   */
  async initialize(items, textFn) {
    await Promise.all([this._semantic.initialize(items, textFn), this._substring.initialize(items)])
  }

  /**
   * Search by embedding similarity, falling back to substring if no results
   * @param {string} query
   * @returns {Promise<Array>} Matching items
   */
  async search(query) {
    if (this._semantic.isInitialized) {
      const results = await this._semantic.search(query)
      if (results.length > 0) {
        return results.map((r) => r.item)
      }
    }

    return this._substring.search(query)
  }
}

/**
 * Factory — picks strategy from config
 * @param {string} [strategy='substring'] - 'substring' or 'embedding'
 * @param {Object} [options] - Options passed to EmbeddingSearch (threshold, topK)
 * @returns {SubstringSearch|EmbeddingSearch}
 */
export function createDomainSearch(strategy = 'substring', options) {
  if (strategy === 'embedding') {
    return new EmbeddingSearch(options)
  }
  return new SubstringSearch()
}
