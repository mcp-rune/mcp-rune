/**
 * Shared `SearchService` factory.
 *
 * Three sites used to instantiate `SearchService` independently with the
 * same conventional arg-extraction pattern (`searchGroups` and
 * `defaultAdapter` read out of `serverContext`): the search extension's
 * `SearchRecordsTool`, the apps registry, and `analysis-ingest-tool`. They
 * all now route through this factory.
 *
 * Keeping the construction in one place means future changes to the
 * `SearchService` constructor signature (e.g., new options) ripple through
 * one edit instead of three.
 */

import type { SearchApiClient } from '#src/core/api-client.js'

import { SearchService } from './search-service.js'
import type { SearchGroup } from './types.js'

/**
 * Shape of the relevant slice of `serverContext` that the factory consumes.
 * Both fields are optional — the factory degrades to empty defaults.
 */
export interface SearchFactoryContext {
  searchGroups?: Record<string, SearchGroup>
  defaultAdapter?: ConstructorParameters<typeof SearchService>[1] extends infer T
    ? T extends { defaultAdapter?: infer A }
      ? A
      : never
    : never
}

/**
 * Construct a `SearchService` bound to the given API client. Pulls
 * `searchGroups` and `defaultAdapter` out of the passed context (typically
 * `tool.serverContext` in a tool, or the analogous field in an app).
 */
export function createSearchService(
  apiClient: SearchApiClient,
  context?: Record<string, unknown>
): SearchService {
  const ctx = (context ?? {}) as SearchFactoryContext
  const searchGroups = ctx.searchGroups ?? {}
  return new SearchService(apiClient, {
    searchGroups,
    defaultAdapter: ctx.defaultAdapter
  } as ConstructorParameters<typeof SearchService>[1])
}
