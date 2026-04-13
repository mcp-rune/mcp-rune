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

export interface PaginationInfo {
  page: number
  per_page: number
  total: number
  total_pages?: number
}

export interface NormalizedListResponse {
  records: Record<string, unknown>[]
  pagination: PaginationInfo
}

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
   * Strip protocol-specific metadata from an API response.
   * Applied at the API client boundary so all consumers receive clean data.
   * Default: no-op. Override in subclasses.
   */
  cleanResponse(data: unknown): unknown {
    return data
  }
}
