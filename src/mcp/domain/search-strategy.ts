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

export interface DomainItem {
  name?: string
  title?: string
  description?: string
  tags?: string[]
  [key: string]: unknown
}

export interface DomainSearchStrategy {
  initialize(items: DomainItem[], textFn?: (item: DomainItem) => string): Promise<void>
  search(query: string): Promise<DomainItem[]>
}

export interface EmbeddingSearchOptions {
  threshold?: number
  topK?: number
}

/**
 * SubstringSearch — default for small datasets (<200 items)
 *
 * Case-insensitive match on name, title, description, and tags.
 * No model loading, resolves instantly.
 */
export class SubstringSearch implements DomainSearchStrategy {
  private _items: DomainItem[]

  constructor(items?: DomainItem[]) {
    this._items = items || []
  }

  /** Store items for later search */
  async initialize(items: DomainItem[], _textFn?: (item: DomainItem) => string): Promise<void> {
    this._items = items
  }

  /** Case-insensitive substring search on name, title, description, tags */
  async search(query: string): Promise<DomainItem[]> {
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
export class EmbeddingSearch implements DomainSearchStrategy {
  private _semantic: SemanticSearch
  private _substring: SubstringSearch

  constructor(options: EmbeddingSearchOptions = {}) {
    this._semantic = new SemanticSearch(options)
    this._substring = new SubstringSearch()
  }

  /** Compute embeddings for all items and store for substring fallback */
  async initialize(items: DomainItem[], textFn?: (item: DomainItem) => string): Promise<void> {
    await Promise.all([
      this._semantic.initialize(items, textFn!),
      this._substring.initialize(items)
    ])
  }

  /** Search by embedding similarity, falling back to substring if no results */
  async search(query: string): Promise<DomainItem[]> {
    if (this._semantic.isInitialized) {
      const results = await this._semantic.search<DomainItem>(query)
      if (results.length > 0) {
        return results.map((r) => r.item)
      }
    }

    return this._substring.search(query)
  }
}

/** Factory — picks strategy from config */
export function createDomainSearch(
  strategy: string = 'substring',
  options?: EmbeddingSearchOptions
): SubstringSearch | EmbeddingSearch {
  if (strategy === 'embedding') {
    return new EmbeddingSearch(options)
  }
  return new SubstringSearch()
}
