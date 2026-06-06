/**
 * JSON API convention (standard REST)
 *
 * Consolidates all API protocol behavior for JSON:API-style APIs:
 *   - Schema derivation: resolveAssociationFields (belongsTo + hasMany -> field definitions)
 *   - Association resolution: resolveAssociationValues (no-op -- _id is native)
 *   - Request formatting: buildRequestPayload (wrapped under model key)
 *   - Response extraction: normalizeListResponse (.data, .meta)
 */

import type { FieldDefinition } from '#src/mcp/model-layer/field-definition.js'
import type {
  BelongsToAssociation,
  HasManyAssociation
} from '#src/mcp/models/association-config.js'

import type { ErrorResponse, NormalizedListResponse } from './base-convention.js'
import { BaseConvention } from './base-convention.js'

/**
 * JSON API convention.
 *
 * belongsTo: one field per association -- {rel}_id (integer)
 * hasMany:   one field per association -- {singular}_ids (array of integers)
 */
class JsonApiConvention extends BaseConvention {
  get name(): string {
    return 'json-api'
  }

  resolveAssociationFields(
    relName: string,
    relConfig: BelongsToAssociation | HasManyAssociation,
    overrides: Record<string, Partial<FieldDefinition>> = {}
  ): Record<string, FieldDefinition> {
    return 'many' in relConfig && relConfig.many
      ? this._resolveHasManyFields(relName, relConfig, overrides)
      : this._resolveBelongsToFields(relName, relConfig as BelongsToAssociation, overrides)
  }

  private _resolveHasManyFields(
    relName: string,
    relConfig: HasManyAssociation,
    overrides: Record<string, Partial<FieldDefinition>>
  ): Record<string, FieldDefinition> {
    const singular = relName.replace(/s$/, '')
    const idsFieldName = `${singular}_ids`

    const fields: Record<string, FieldDefinition> = {
      [idsFieldName]: {
        name: idsFieldName,
        type: 'array',
        items: { type: 'integer' },
        required: relConfig.required || false,
        description: relConfig.description || `IDs of the ${relName}`,
        examples: [[1, 2, 3]],
        ...(overrides[idsFieldName] || {})
      }
    }

    if (relConfig.autocomplete !== false) {
      fields[idsFieldName]!.completion = {
        enabled: true,
        provider: 'relation',
        target_model: relConfig.target_model,
        search_fields: ['name'],
        display_template: '{name} (ID: {id})',
        value_field: 'id',
        ...(overrides[idsFieldName]?.completion || {})
      }
    }

    return fields
  }

  private _resolveBelongsToFields(
    relName: string,
    relConfig: BelongsToAssociation,
    overrides: Record<string, Partial<FieldDefinition>>
  ): Record<string, FieldDefinition> {
    const idFieldName = `${relName}_id`

    const fields: Record<string, FieldDefinition> = {
      [idFieldName]: {
        name: idFieldName,
        type: 'integer',
        required: relConfig.required || false,
        description: relConfig.description || `ID of the ${relName}`,
        examples: [1, 2, 3],
        ...(overrides[idFieldName] || {})
      }
    }

    if (relConfig.autocomplete !== false) {
      fields[idFieldName]!.completion = {
        enabled: true,
        provider: 'relation',
        target_model: relConfig.target_model,
        search_fields: ['name'],
        display_template: '{name} (ID: {id})',
        value_field: 'id',
        ...(overrides[idFieldName]?.completion || {})
      }
    }

    return fields
  }

  resolveAssociationValues(attrs: Record<string, unknown>): Record<string, unknown> {
    return attrs
  }

  /** Wrapped payload: { [model]: attrs } */
  buildRequestPayload(model: string, attrs: Record<string, unknown>): Record<string, unknown> {
    return { [model]: attrs }
  }

  /**
   * Extract records + pagination from JSON:API responses.
   *
   * Handles:
   *   - Plain arrays
   *   - { data: [...], meta: {...} } format
   */
  normalizeListResponse(
    response: Record<string, unknown> | unknown[],
    { page, perPage }: { page: number; perPage: number }
  ): NormalizedListResponse {
    const records = Array.isArray(response)
      ? (response as Record<string, unknown>[])
      : ((response.data || []) as Record<string, unknown>[])
    const pagination = (response as Record<string, unknown>).meta
      ? ({ ...((response as Record<string, unknown>).meta as Record<string, unknown>) } as {
          page: number
          per_page: number
          total: number
          total_pages?: number
        })
      : { page, per_page: perPage, total: records.length }
    return { records, pagination }
  }

  /**
   * Parse Rails/JSON API error responses into flat error messages.
   *
   * Handles:
   *   - { error: "message" }              → ["message"]
   *   - { errors: { field: [msgs] } }     → ["field: msg1, msg2", ...]
   *   - { errors: ["msg1", "msg2"] }      → ["msg1", "msg2"]
   *   - unknown shape                     → fallback to base (JSON dump)
   */
  override parseErrorResponse(response: ErrorResponse): string[] {
    const data = response.data
    if (data === undefined || data === null) return []
    if (typeof data === 'string') return [data]
    if (typeof data !== 'object') return [String(data)]

    const obj = data as Record<string, unknown>

    // { error: "single message" }
    if (typeof obj.error === 'string') return [obj.error]

    // { errors: { field: [messages] } } — Rails validation hash
    if (obj.errors && typeof obj.errors === 'object' && !Array.isArray(obj.errors)) {
      const lines: string[] = []
      for (const [field, messages] of Object.entries(obj.errors as Record<string, unknown>)) {
        if (Array.isArray(messages)) lines.push(`${field}: ${messages.join(', ')}`)
        else if (typeof messages === 'string') lines.push(`${field}: ${messages}`)
      }
      if (lines.length > 0) return lines
    }

    // { errors: ["msg1", "msg2"] }
    if (Array.isArray(obj.errors)) return obj.errors.map((e: unknown) => String(e))

    // Unknown shape — delegate to base
    return super.parseErrorResponse(response)
  }

  /** Strip `_links` (HAL/HATEOAS metadata) from API responses recursively. */
  cleanResponse(data: unknown): unknown {
    return stripLinks(data)
  }
}

function stripLinks(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripLinks)

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === '_links') continue
    result[key] = typeof val === 'object' && val !== null ? stripLinks(val) : val
  }
  return result
}

export const jsonApiConvention = new JsonApiConvention()
