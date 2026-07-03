/**
 * Shared `SearchService` factory.
 *
 * The two registry composition roots (`ToolRegistry`, `AppRegistry`)
 * construct one `SearchService` per authenticated request and hide it
 * behind `SearchEnabledDataLayer` — projection code only ever sees the
 * `*Normalized` methods on the `DataLayer` seam. Keeping the construction
 * in one place means future changes to the `SearchService` constructor
 * signature ripple through one edit.
 */

import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'

import { SearchService } from './search-service.js'
import type { SearchServiceOptions } from './types.js'

/** Construct a `SearchService` bound to the given `DataLayer`. */
export function createSearchService(
  dataLayer: DataLayer,
  options: SearchServiceOptions = {}
): SearchService {
  return new SearchService(dataLayer, {
    searchGroups: options.searchGroups ?? {},
    defaultShaper: options.defaultShaper
  } as ConstructorParameters<typeof SearchService>[1])
}
