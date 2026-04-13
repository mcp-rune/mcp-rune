/**
 * HAL/hypermedia convention (Movida API)
 *
 * Consolidates all API protocol behavior for HAL-style APIs:
 *   - Schema derivation: resolveAssociationFields (belongsTo + hasMany → field definitions)
 *   - Association resolution: resolveAssociationValues (_id → _link URL)
 *   - Request formatting: buildRequestPayload (flat — Movida wraps server-side)
 *   - Response extraction: normalizeListResponse (_embedded, model-keyed arrays)
 */

import { BaseConvention } from './base-convention.js'

/**
 * HAL convention.
 *
 * belongsTo: two fields per association — {rel}_link (URL) + {rel}_id (convenience)
 * hasMany:   one field per association — {singular}_ids (array of strings)
 */
class HalConvention extends BaseConvention {
  get name() {
    return 'hal'
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
        items: { type: 'string' },
        required: relConfig.required || false,
        description: relConfig.description || `IDs of the ${relName}`,
        examples: [['123', '456']],
        ...(overrides[idsFieldName] || {})
      }
    }

    if (relConfig.autocomplete !== false) {
      fields[idsFieldName].completion = {
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

  _resolveBelongsToFields(relName, relConfig, overrides) {
    const linkFieldName = `${relName}_link`
    const idFieldName = `${relName}_id`

    const fields = {
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
      fields[linkFieldName].completion = {
        enabled: true,
        provider: 'relation',
        target_model: relConfig.target_model,
        search_fields: ['name', 'external_id'],
        display_template: '{name} ({external_id})',
        value_field: 'self_link',
        ...(overrides[linkFieldName]?.completion || {})
      }

      fields[idFieldName].completion = {
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
   *
   * @param {Object} attrs - Attribute key-value pairs
   * @param {Object} belongsTo - Model's belongsTo associations
   * @param {string} [apiBaseUrl] - API base URL for URL construction
   * @returns {Object} Attributes with _id replaced by _link where applicable
   */
  resolveAssociationValues(attrs, belongsTo, apiBaseUrl) {
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

  /**
   * Flat payload — Movida wraps server-side via ParamsApiParser.
   *
   * @param {string} _model - Singular model name (unused)
   * @param {Object} attrs - Attribute key-value pairs
   * @returns {Object} Raw attributes
   */
  buildRequestPayload(_model, attrs) {
    return attrs
  }

  /**
   * Extract records + pagination from HAL responses.
   *
   * Handles:
   *   - Plain arrays
   *   - HAL _embedded.{key} format
   *   - Model-keyed top-level arrays (e.g., { platforms: [...] })
   *
   * @param {Object|Array} response - Raw API response
   * @param {Object} options
   * @param {number} options.page - Requested page
   * @param {number} options.perPage - Requested per_page
   * @returns {{ records: Object[], pagination: Object }}
   */
  normalizeListResponse(response, { page, perPage }) {
    let records
    if (Array.isArray(response)) {
      records = response
    } else if (response._embedded) {
      const key = Object.keys(response._embedded).find((k) => Array.isArray(response._embedded[k]))
      records = key ? response._embedded[key] : []
    } else {
      const key = Object.keys(response).find((k) => Array.isArray(response[k]) && k !== '_links')
      records = key ? response[key] : []
    }

    const pagination = {
      page: response.page || page,
      per_page: response.per_page || perPage,
      total: response.total_count ?? response.total_entries ?? response.total ?? records.length,
      total_pages: response.total_pages
    }

    return { records, pagination }
  }
}

export const halConvention = new HalConvention()
