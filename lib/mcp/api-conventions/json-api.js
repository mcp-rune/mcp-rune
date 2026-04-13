/**
 * JSON API convention (standard REST)
 *
 * Consolidates all API protocol behavior for JSON:API-style APIs:
 *   - Schema derivation: resolveAssociationFields (belongsTo + hasMany → field definitions)
 *   - Association resolution: resolveAssociationValues (no-op — _id is native)
 *   - Request formatting: buildRequestPayload (wrapped under model key)
 *   - Response extraction: normalizeListResponse (.data, .meta)
 */

import { BaseConvention } from './base-convention.js'

/**
 * JSON API convention.
 *
 * belongsTo: one field per association — {rel}_id (integer)
 * hasMany:   one field per association — {singular}_ids (array of integers)
 */
class JsonApiConvention extends BaseConvention {
  get name() {
    return 'json-api'
  }

  resolveAssociationFields(relName, relConfig, overrides = {}) {
    return relConfig.many
      ? this._resolveHasManyFields(relName, relConfig, overrides)
      : this._resolveBelongsToFields(relName, relConfig, overrides)
  }

  _resolveHasManyFields(relName, relConfig, overrides) {
    const singular = relName.replace(/s$/, '')
    const idsFieldName = `${singular}_ids`

    const fields = {
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
      fields[idsFieldName].completion = {
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

  _resolveBelongsToFields(relName, relConfig, overrides) {
    const idFieldName = `${relName}_id`

    const fields = {
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
      fields[idFieldName].completion = {
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

  resolveAssociationValues(attrs) {
    return attrs
  }

  /**
   * Wrapped payload: { [model]: attrs }
   *
   * @param {string} model - Singular model name
   * @param {Object} attrs - Attribute key-value pairs
   * @returns {Object} Request payload wrapped in model key
   */
  buildRequestPayload(model, attrs) {
    return { [model]: attrs }
  }

  /**
   * Extract records + pagination from JSON:API responses.
   *
   * Handles:
   *   - Plain arrays
   *   - { data: [...], meta: {...} } format
   *
   * @param {Object|Array} response - Raw API response
   * @param {Object} options
   * @param {number} options.page - Requested page
   * @param {number} options.perPage - Requested per_page
   * @returns {{ records: Object[], pagination: Object }}
   */
  normalizeListResponse(response, { page, perPage }) {
    const records = Array.isArray(response) ? response : response.data || []
    const pagination = response.meta
      ? { ...response.meta }
      : { page, per_page: perPage, total: records.length }
    return { records, pagination }
  }

  /**
   * Strip `_links` (HAL/HATEOAS metadata) from API responses recursively.
   * @param {*} data - Raw API response data
   * @returns {*} Data without _links at any level
   */
  cleanResponse(data) {
    return stripLinks(data)
  }
}

function stripLinks(value) {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripLinks)

  const result = {}
  for (const [key, val] of Object.entries(value)) {
    if (key === '_links') continue
    result[key] = typeof val === 'object' && val !== null ? stripLinks(val) : val
  }
  return result
}

export const jsonApiConvention = new JsonApiConvention()
