/**
 * RailsSearchRequestShaper — Adapter for Rails-convention search endpoints.
 *
 * Extends the base SearchRequestShaper with two Rails-specific behaviors:
 *
 * 1. **filtersParam nesting** — wraps filters under a configurable key
 *    (e.g., `{ filters: { category_id: 4 } }` instead of flat `{ category_id: 4 }`)
 *
 * 2. **rangeMappings** — flattens `{ from, to }` range filter values into
 *    the flat keys the Rails API expects (e.g., `min_duration`, `max_duration`)
 *
 * ## Configuration
 *
 * `filtersParam` can be set at two levels:
 * - **Server-wide** via the constructor: `new RailsSearchRequestShaper({ filtersParam: 'filters' })`
 * - **Per-model override** via `search.query.shaperConfig.filtersParam`
 *
 * `rangeMappings` are per-model only, declared in `search.query.shaperConfig.rangeMappings`.
 *
 * Per-model `shaperConfig` values take precedence over constructor defaults.
 *
 * @example Server setup
 * const adapter = new RailsSearchRequestShaper({ filtersParam: 'filters' })
 * const client = new SearchService(api, { defaultShaper: adapter })
 *
 * @example Model config with rangeMappings
 * static search = {
 *   query: {
 *     endpoint: 'activities/search',
 *     method: 'POST',
 *     queryParam: 'q',
 *     shaperConfig: {
 *       rangeMappings: {
 *         duration_minutes: { from: 'min_duration', to: 'max_duration' },
 *         started_at: { from: 'started_after', to: 'started_before' }
 *       }
 *     }
 *   },
 *   filters: {
 *     category_id: { type: 'relation', relatedModel: 'category' },
 *     duration_minutes: { type: 'integer_range' },
 *     started_at: { type: 'date_range' }
 *   },
 *   lookup: { fields: ['title', 'description'] }
 * }
 *
 * // LLM sends:  { filters: { category_id: 4, duration_minutes: { from: 40, to: 120 } } }
 * // Adapter produces: { filters: { category_id: 4, min_duration: 40, max_duration: 120 } }
 * // → POST /activities/search
 */

import type { Pagination, SearchConfig } from '../types.js'
import { SearchRequestShaper } from './default.js'

export interface RailsShaperConfig {
  filtersParam?: string
  rangeMappings?: Record<string, { from: string; to: string }>
}

export class RailsSearchRequestShaper extends SearchRequestShaper {
  private _filtersParam: string | undefined

  constructor({ filtersParam }: { filtersParam?: string } = {}) {
    super()
    this._filtersParam = filtersParam
  }

  override buildBody(
    query: string | null,
    filters: Record<string, unknown> | undefined,
    pagination: Pagination,
    searchConfig: SearchConfig
  ): Record<string, unknown> {
    const shaperConfig = (searchConfig?.query?.shaperConfig || {}) as RailsShaperConfig
    const filtersParam = shaperConfig.filtersParam ?? this._filtersParam
    const rangeMappings = shaperConfig.rangeMappings

    const adaptedFilters = this._applyRangeMappings(filters, rangeMappings)

    if (filtersParam && adaptedFilters && Object.keys(adaptedFilters).length > 0) {
      // Nest adapted filters under the configured key
      const body = super.buildBody(query, undefined, pagination, searchConfig)
      body[filtersParam] = adaptedFilters
      return body
    }

    // No filtersParam — fall back to flat spread with adapted filters
    return super.buildBody(query, adaptedFilters, pagination, searchConfig)
  }

  /**
   * Flatten `{ from, to }` range filter values into the flat keys the API expects.
   * Non-range filters pass through unchanged. Returns a shallow copy.
   */
  private _applyRangeMappings(
    filters: Record<string, unknown> | undefined,
    rangeMappings: RailsShaperConfig['rangeMappings']
  ): Record<string, unknown> | undefined {
    if (!filters || !rangeMappings) return filters

    const adapted: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(filters)) {
      const mapping = rangeMappings[key]

      if (mapping && typeof value === 'object' && value !== null) {
        const rangeValue = value as { from?: unknown; to?: unknown }
        if (rangeValue.from !== undefined) adapted[mapping.from] = rangeValue.from
        if (rangeValue.to !== undefined) adapted[mapping.to] = rangeValue.to
      } else {
        adapted[key] = value
      }
    }

    return adapted
  }
}
