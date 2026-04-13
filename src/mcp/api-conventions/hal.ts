/**
 * HAL/hypermedia convention (Movida API)
 *
 * Consolidates all API protocol behavior for HAL-style APIs:
 *   - Schema derivation: resolveAssociationFields (belongsTo + hasMany -> field definitions)
 *   - Association resolution: resolveAssociationValues (_id -> _link URL)
 *   - Request formatting: buildRequestPayload (flat -- Movida wraps server-side)
 *   - Response extraction: normalizeListResponse (_embedded, model-keyed arrays)
 */

import {
  BaseConvention,
} from './base-convention.js'
import type {
  BelongsToAssociation,
  FieldDefinition,
  HasManyAssociation,
  NormalizedListResponse,
} from './base-convention.js'

/**
 * HAL convention.
 *
 * belongsTo: two fields per association -- {rel}_link (URL) + {rel}_id (convenience)
 * hasMany:   one field per association -- {singular}_ids (array of strings)
 */
class HalConvention extends BaseConvention {
  get name(): string {
    return 'hal'
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
        items: { type: 'string' },
        required: relConfig.required || false,
        description: relConfig.description || `IDs of the ${relName}`,
        examples: [['123', '456']],
        ...(overrides[idsFieldName] || {})
      }
    }

    if (relConfig.autocomplete !== false) {
      fields[idsFieldName]!.completion = {
        enabled: true,
        provider: 'relation',
        target_model: relConfig.target_model,
        search_fields: ['name', 'external_id'],
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
    const linkFieldName = `${relName}_link`
    const idFieldName = `${relName}_id`

    const fields: Record<string, FieldDefinition> = {
      [linkFieldName]: {
        name: linkFieldName,
        type: 'string',
        required: false,
        description: `URL link to the ${relName} resource`,
        examples: [`https://api.example.com/${relConfig.target_model}s/123`],
        ...(overrides[linkFieldName] || {})
      },
      [idFieldName]: {
        name: idFieldName,
        type: 'string',
        required: false,
        description: `ID of the ${relName} (convenience field)`,
        examples: ['123', '456'],
        ...(overrides[idFieldName] || {})
      }
    }

    if (relConfig.autocomplete !== false) {
      fields[linkFieldName]!.completion = {
        enabled: true,
        provider: 'relation',
        target_model: relConfig.target_model,
        search_fields: ['name', 'external_id'],
        display_template: '{name} ({external_id})',
        value_field: 'self_link',
        ...(overrides[linkFieldName]?.completion || {})
      }

      fields[idFieldName]!.completion = {
        enabled: true,
        provider: 'relation',
        target_model: relConfig.target_model,
        search_fields: ['name', 'external_id'],
        display_template: '{name} (ID: {id})',
        value_field: 'id',
        ...(overrides[idFieldName]?.completion || {})
      }
    }

    return fields
  }

  /**
   * Resolve _id attributes to _link URLs for HAL APIs.
   *
   * For each belongsTo association, if attrs contains {rel}_id but not {rel}_link,
   * constructs the link URL from the API base URL and the target model endpoint.
   */
  resolveAssociationValues(
    attrs: Record<string, unknown>,
    belongsTo?: Record<string, BelongsToAssociation>,
    apiBaseUrl?: string
  ): Record<string, unknown> {
    if (!belongsTo || !apiBaseUrl) return attrs

    const resolved = { ...attrs }

    for (const [relName, relConfig] of Object.entries(belongsTo)) {
      const idKey = `${relName}_id`
      const linkKey = `${relName}_link`

      // Only resolve if _id is present and _link is not already set
      if (resolved[idKey] && !resolved[linkKey]) {
        const endpoint = relConfig.endpoint || `${relConfig.target_model}s`
        resolved[linkKey] = `${apiBaseUrl}/${endpoint}/${resolved[idKey]}`
        delete resolved[idKey]
      }
    }

    return resolved
  }

  /** Flat payload -- Movida wraps server-side via ParamsApiParser. */
  buildRequestPayload(_model: string, attrs: Record<string, unknown>): Record<string, unknown> {
    return attrs
  }

  /**
   * Extract records + pagination from HAL responses.
   *
   * Handles:
   *   - Plain arrays
   *   - HAL _embedded.{key} format
   *   - Model-keyed top-level arrays (e.g., { platforms: [...] })
   */
  normalizeListResponse(
    response: Record<string, unknown> | unknown[],
    { page, perPage }: { page: number; perPage: number }
  ): NormalizedListResponse {
    let records: Record<string, unknown>[]
    if (Array.isArray(response)) {
      records = response as Record<string, unknown>[]
    } else if (response._embedded) {
      const embedded = response._embedded as Record<string, unknown>
      const key = Object.keys(embedded).find((k) => Array.isArray(embedded[k]))
      records = key ? (embedded[key] as Record<string, unknown>[]) : []
    } else {
      const key = Object.keys(response).find((k) => Array.isArray(response[k]) && k !== '_links')
      records = key ? (response[key] as Record<string, unknown>[]) : []
    }

    const pagination = {
      page: (response as Record<string, unknown>).page as number || page,
      per_page: (response as Record<string, unknown>).per_page as number || perPage,
      total: ((response as Record<string, unknown>).total_count ??
        (response as Record<string, unknown>).total_entries ??
        (response as Record<string, unknown>).total ??
        records.length) as number,
      total_pages: (response as Record<string, unknown>).total_pages as number | undefined
    }

    return { records, pagination }
  }
}

export const halConvention = new HalConvention()
