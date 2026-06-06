/**
 * Test-only convention with flat payloads and HAL-like response parsing.
 *
 * Used as a fixture in framework tests that need a non-default convention
 * to verify convention-aware behavior (e.g., flat payloads, _embedded
 * response extraction, expanded resource flattening).
 */

import type {
  AssociationConfig,
  BelongsToAssociation,
  FieldDefinition,
  HasManyAssociation,
  NormalizedListResponse
} from '../../src/mcp/data-layer/api-conventions/base-convention.js'
import { BaseConvention } from '../../src/mcp/data-layer/api-conventions/base-convention.js'

class FlatConvention extends BaseConvention {
  get name(): string {
    return 'flat'
  }

  resolveAssociationFields(
    relName: string,
    relConfig: BelongsToAssociation | HasManyAssociation,
    overrides: Record<string, Partial<FieldDefinition>> = {}
  ): Record<string, FieldDefinition> {
    if ('many' in relConfig && relConfig.many) {
      const singular = relName.replace(/s$/, '')
      const idsFieldName = `${singular}_ids`
      return {
        [idsFieldName]: {
          name: idsFieldName,
          type: 'array',
          items: { type: 'string' },
          required: relConfig.required || false,
          description: `IDs of the ${relName}`,
          examples: [['123', '456']],
          ...(overrides[idsFieldName] || {})
        }
      }
    }

    const linkFieldName = `${relName}_link`
    const idFieldName = `${relName}_id`
    return {
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
  }

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
      if (resolved[idKey] && !resolved[linkKey]) {
        const endpoint = relConfig.endpoint || `${relConfig.target_model}s`
        resolved[linkKey] = `${apiBaseUrl}/${endpoint}/${resolved[idKey]}`
        delete resolved[idKey]
      }
    }
    return resolved
  }

  buildRequestPayload(_model: string, attrs: Record<string, unknown>): Record<string, unknown> {
    return attrs
  }

  private _locateRecords(response: Record<string, unknown> | unknown[]): Record<string, unknown>[] {
    if (Array.isArray(response)) return response as Record<string, unknown>[]
    if (response._embedded) {
      const embedded = response._embedded as Record<string, unknown>
      const key = Object.keys(embedded).find((k) => Array.isArray(embedded[k]))
      return key ? (embedded[key] as Record<string, unknown>[]) : []
    }
    const key = Object.keys(response).find((k) => Array.isArray(response[k]) && k !== '_links')
    return key ? (response[key] as Record<string, unknown>[]) : []
  }

  normalizeListResponse(
    response: Record<string, unknown> | unknown[],
    { page, perPage }: { page: number; perPage: number }
  ): NormalizedListResponse {
    const records = this._locateRecords(response)
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

  override flattenExpandedResources(
    records: Record<string, unknown>[],
    associations?: AssociationConfig,
    requestedFields?: string[]
  ): Record<string, unknown>[] {
    if (records.length === 0) return records

    const expandableKeys = this._getExpandableKeys(records[0]!, associations)
    if (expandableKeys.length === 0) return records

    const flattenMap = this._buildFlattenMap(expandableKeys, records[0]!, requestedFields)
    if (Object.keys(flattenMap).length === 0) return records

    return records.map((record) => this._flattenRecord(record, flattenMap))
  }

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
        if (childKey === 'resource_type' || childKey.endsWith('_link')) continue
        if (childVal !== null && typeof childVal === 'object') continue
        const flatKey = `${key}_${childKey}`
        if (requestedSet === null || requestedSet.has(flatKey)) {
          mappings.push({ childKey, flatKey })
        }
      }

      const idFlatKey = `${key}_id`
      const hasId = mappings.some((m) => m.flatKey === idFlatKey)
      if (!hasId && 'id' in nested) {
        mappings.push({ childKey: 'id', flatKey: idFlatKey })
      }

      if (mappings.length > 0) map[key] = mappings
    }
    return map
  }

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

  override extractNestedRecords(
    response: Record<string, unknown> | unknown[],
    attributes?: Record<string, unknown>
  ): Record<string, unknown>[] {
    const records = this._locateRecords(response)
    if (!attributes) return records
    const allowedKeys = new Set([...Object.keys(attributes), 'id'])
    return records.map((record) => {
      const clean: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(record)) {
        if (allowedKeys.has(k)) clean[k] = v
      }
      return clean
    })
  }
}

export const flatConvention = new FlatConvention()
