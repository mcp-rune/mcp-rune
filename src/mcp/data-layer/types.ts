/**
 * DataLayer-level type definitions shared by the interface, conventions, and
 * extensions that decorate it. Kept separate from `data-layer.ts` so that
 * dependent layers (api-conventions, api-extensions/search) can import these
 * envelopes without circling back through the interface module.
 */

export interface PaginationInfo {
  page: number
  per_page: number
  total: number
  total_pages?: number
}

/**
 * The flat-records-plus-pagination envelope returned by
 * `DataLayer.listNormalized`, `DataLayer.searchNormalized`,
 * `DataLayer.lookupNormalized`, and `DataLayer.groupSearchNormalized`.
 *
 * Adapters apply the model's convention internally before returning this
 * shape, so projection-layer callers (apps/tools/prompts) never need to
 * reach for `defaultConvention` themselves.
 */
export interface NormalizedListResponse {
  records: Record<string, unknown>[]
  pagination: PaginationInfo
}
