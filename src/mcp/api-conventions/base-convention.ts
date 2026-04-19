/**
 * BaseConvention — formal interface contract for API conventions.
 *
 * Every convention (HAL, JSON API, etc.) must extend this class and implement
 * all methods. Methods throw if not implemented, failing fast instead of
 * silently returning undefined.
 *
 * Convention methods:
 *   - resolveAssociationFields: schema derivation (association -> field definitions)
 *   - resolveAssociationValues: translate _id attrs to convention-specific fields before API submission
 *   - buildRequestPayload: format request body for the API
 *   - normalizeListResponse: extract records + pagination from API responses
 *   - cleanResponse: strip protocol metadata from API responses (e.g., _links for HAL)
 */

export interface CompletionConfig {
  enabled: boolean
  provider?: string
  target_model?: string
  search_fields?: string[]
  display_template?: string
  value_field?: string
}

export interface FieldDefinition {
  name: string
  type: string
  required: boolean
  description: string
  examples?: unknown[]
  items?: { type: string }
  completion?: CompletionConfig
  enumValues?: string[]
  format?: string
  default?: unknown
  label?: string
  validation?: Record<string, unknown>
}

export interface BelongsToAssociation {
  target_model: string
  required?: boolean
  description?: string
  endpoint?: string
  autocomplete?: boolean
}

export interface HasManyAssociation {
  target_model: string
  required?: boolean
  many: true
  description?: string
  autocomplete?: boolean
}

export interface AssociationConfig {
  belongsTo?: Record<string, BelongsToAssociation>
  hasMany?: Record<string, HasManyAssociation>
}

import type { NormalizedListResponse } from '#src/mcp/search/types.js'
export type { NormalizedListResponse, PaginationInfo } from '#src/mcp/search/types.js'

export class BaseConvention {
  get name(): string {
    throw new Error('Convention must implement name')
  }

  /**
   * Generate field definitions for an association (belongsTo or hasMany).
   *
   * belongsTo (relConfig.many falsy):
   *   HAL produces two fields ({rel}_link + {rel}_id).
   *   JSON API produces one field ({rel}_id).
   *
   * hasMany (relConfig.many truthy):
   *   Both produce one array field ({singular}_ids).
   */
  resolveAssociationFields(
    _relName: string,
    _relConfig: BelongsToAssociation | HasManyAssociation,
    _overrides?: Record<string, Partial<FieldDefinition>>
  ): Record<string, FieldDefinition> {
    throw new Error(`${this.constructor.name} must implement resolveAssociationFields`)
  }

  /**
   * Resolve association _id attributes into convention-specific API fields.
   *
   * For HAL: title_id: 123 -> title_link: 'https://api.../titles/123'
   * For JSON API: no-op (API accepts _id directly)
   */
  resolveAssociationValues(
    _attrs: Record<string, unknown>,
    _belongsTo?: Record<string, BelongsToAssociation>,
    _apiBaseUrl?: string
  ): Record<string, unknown> {
    throw new Error(`${this.constructor.name} must implement resolveAssociationValues`)
  }

  /**
   * Format attributes into the API's expected request body.
   *
   * HAL: flat attributes (server wraps).
   * JSON API: wrapped under model key { [model]: attrs }.
   */
  buildRequestPayload(_model: string, _attrs: Record<string, unknown>): Record<string, unknown> {
    throw new Error(`${this.constructor.name} must implement buildRequestPayload`)
  }

  /**
   * Extract records and pagination from an API list response.
   */
  normalizeListResponse(
    _response: Record<string, unknown> | unknown[],
    _options: { page: number; perPage: number }
  ): NormalizedListResponse {
    throw new Error(`${this.constructor.name} must implement normalizeListResponse`)
  }

  /**
   * Flatten inline/expanded association objects into top-level scalar fields.
   *
   * When an API response includes expanded (inlined) associated resources,
   * this method promotes their scalar child fields to the top level using
   * the naming pattern `{association}_{childField}`.
   *
   * Convention-specific: each convention knows what "expanded" looks like
   * in its wire format and which fields to skip (protocol metadata).
   *
   * @param records        - Raw API response records (post-cleanResponse)
   * @param associations   - The model's association config, used to identify
   *                         which top-level keys are expandable associations
   * @param requestedFields - When provided, only flatten child fields whose
   *                         derived name (`{assoc}_{child}`) matches a
   *                         requested field. Association IDs (`{assoc}_id`)
   *                         are always included regardless of this filter.
   *                         When omitted, all scalar child fields are flattened.
   * @returns New records with expanded objects replaced by flat scalar fields.
   */
  flattenExpandedResources(
    _records: Record<string, unknown>[],
    _associations?: AssociationConfig,
    _requestedFields?: string[]
  ): Record<string, unknown>[] {
    return _records
  }

  /**
   * Extract records from a nested resource API response.
   *
   * Convention-specific: each convention knows how to locate the records
   * array in its response envelope (e.g., HAL uses `entries`, JSON API uses
   * `data`, etc.) and which protocol metadata to strip from each record.
   *
   * @param response   - Raw API response from the nested endpoint
   * @param attributes - The child model's attribute definitions. When provided,
   *                     acts as a whitelist — only declared attribute keys (plus
   *                     `id`) are retained per record. Protocol-specific fields
   *                     are excluded. When omitted, all fields pass through.
   * @returns Cleaned records array
   */
  extractNestedRecords(
    response: Record<string, unknown> | unknown[],
    _attributes?: Record<string, unknown>
  ): Record<string, unknown>[] {
    if (Array.isArray(response)) return response as Record<string, unknown>[]
    return ((response as Record<string, unknown>)?.data ??
      (response as Record<string, unknown>)?.records ??
      []) as Record<string, unknown>[]
  }

  /**
   * Strip protocol-specific metadata from an API response.
   * Applied at the API client boundary so all consumers receive clean data.
   * Default: no-op. Override in subclasses.
   */
  cleanResponse(data: unknown): unknown {
    return data
  }
}
