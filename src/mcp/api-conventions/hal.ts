/**
 * HAL/hypermedia convention (Movida API)
 *
 * Consolidates all API protocol behavior for HAL-style APIs:
 *   - Schema derivation: resolveAssociationFields (belongsTo + hasMany -> field definitions)
 *   - Association resolution: resolveAssociationValues (_id -> _link URL)
 *   - Request formatting: buildRequestPayload (flat -- Movida wraps server-side)
 *   - Response extraction: normalizeListResponse (_embedded, model-keyed arrays)
 *   - Expanded resource flattening: flattenExpandedResources (nested objects -> flat scalars)
 */

import type {
  AssociationConfig,
  BelongsToAssociation,
  FieldDefinition,
  HasManyAssociation,
  NormalizedListResponse
} from './base-convention.js'
import { BaseConvention } from './base-convention.js'

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
      page: ((response as Record<string, unknown>).page as number) || page,
      per_page: ((response as Record<string, unknown>).per_page as number) || perPage,
      total: ((response as Record<string, unknown>).total_count ??
        (response as Record<string, unknown>).total_entries ??
        (response as Record<string, unknown>).total ??
        records.length) as number,
      total_pages: (response as Record<string, unknown>).total_pages as number | undefined
    }

    return { records, pagination }
  }

  // ---------------------------------------------------------------------------
  // Expanded resource flattening
  // ---------------------------------------------------------------------------

  /**
   * Flatten inline/expanded HAL association objects into top-level scalar fields.
   *
   * When a HAL API responds with `?expand=title,platform`, each record contains
   * nested objects like `title: { resource_type: "title", id: 58, name: "Pilot" }`.
   * This method promotes their scalar child fields using the `{assoc}_{child}`
   * naming pattern (e.g., `title_name`, `platform_name`).
   *
   * Association IDs (`{assoc}_id`) are always included — they serve as stable
   * foreign keys the LLM can use for cross-referencing and follow-up queries.
   *
   * HAL protocol metadata (`resource_type`, `*_link`) is excluded from flattening.
   */
  override flattenExpandedResources(
    records: Record<string, unknown>[],
    associations?: AssociationConfig,
    requestedFields?: string[]
  ): Record<string, unknown>[] {
    if (records.length === 0) return records

    // Identify which top-level keys are expanded belongsTo associations
    const expandableKeys = this._getExpandableKeys(records[0]!, associations)
    if (expandableKeys.length === 0) return records

    // Build flatten map constrained by requestedFields (with {assoc}_id always included)
    const flattenMap = this._buildFlattenMap(expandableKeys, records[0]!, requestedFields)
    if (Object.keys(flattenMap).length === 0) return records

    return records.map((record) => this._flattenRecord(record, flattenMap))
  }

  /**
   * Identify which top-level keys in a record are expanded associations.
   *
   * Strategy (ordered by reliability):
   * 1. If associations.belongsTo is available, use its keys as the canonical
   *    set — only those whose value is a non-null object in the actual record
   *    are considered expanded (the API may not expand all associations).
   * 2. Fallback (no associations config): detect objects with a `resource_type`
   *    field, which is the HAL convention marker for embedded resources.
   */
  private _getExpandableKeys(
    sample: Record<string, unknown>,
    associations?: AssociationConfig
  ): string[] {
    const belongsTo = associations?.belongsTo
    if (belongsTo) {
      return Object.keys(belongsTo).filter((key) => {
        const val = sample[key]
        return val !== null && typeof val === 'object' && !Array.isArray(val)
      })
    }

    // Heuristic fallback: detect HAL expanded resources by resource_type
    return Object.entries(sample)
      .filter(
        ([, val]) =>
          val !== null &&
          typeof val === 'object' &&
          !Array.isArray(val) &&
          typeof (val as Record<string, unknown>).resource_type === 'string'
      )
      .map(([key]) => key)
  }

  /**
   * Build a mapping from expanded keys to their flattened child fields.
   *
   * When requestedFields is provided, only includes mappings where the derived
   * flat name (`{key}_{childKey}`) is in the requested set. The `{assoc}_id`
   * mapping is always included regardless of the filter — association IDs are
   * stable foreign keys that should always be available.
   *
   * HAL protocol fields (`resource_type`, `*_link`) are always excluded.
   */
  private _buildFlattenMap(
    expandableKeys: string[],
    sample: Record<string, unknown>,
    requestedFields?: string[]
  ): Record<string, Array<{ childKey: string; flatKey: string }>> {
    const requestedSet = requestedFields ? new Set(requestedFields) : null
    const map: Record<string, Array<{ childKey: string; flatKey: string }>> = {}

    for (const key of expandableKeys) {
      const nested = sample[key] as Record<string, unknown>
      const mappings: Array<{ childKey: string; flatKey: string }> = []

      for (const [childKey, childVal] of Object.entries(nested)) {
        // Skip HAL protocol metadata
        if (childKey === 'resource_type' || childKey.endsWith('_link')) continue
        // Only flatten scalars (string, number, boolean, null)
        if (childVal !== null && typeof childVal === 'object') continue

        const flatKey = `${key}_${childKey}`
        if (requestedSet === null || requestedSet.has(flatKey)) {
          mappings.push({ childKey, flatKey })
        }
      }

      // Always include {assoc}_id if present in the nested object — stable
      // foreign key for cross-referencing, regardless of requestedFields
      const idFlatKey = `${key}_id`
      const hasId = mappings.some((m) => m.flatKey === idFlatKey)
      if (!hasId && 'id' in nested) {
        mappings.push({ childKey: 'id', flatKey: idFlatKey })
      }

      if (mappings.length > 0) {
        map[key] = mappings
      }
    }

    return map
  }

  /**
   * Apply the flatten map to a single record.
   *
   * Expanded keys are replaced by their flattened children;
   * all other keys pass through unchanged.
   */
  private _flattenRecord(
    record: Record<string, unknown>,
    flattenMap: Record<string, Array<{ childKey: string; flatKey: string }>>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(record)) {
      if (key in flattenMap) {
        const nested = val as Record<string, unknown> | null
        for (const { childKey, flatKey } of flattenMap[key]!) {
          result[flatKey] = nested ? (nested[childKey] ?? null) : null
        }
      } else {
        result[key] = val
      }
    }

    return result
  }
}

export const halConvention = new HalConvention()
