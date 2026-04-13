/**
 * BaseConvention — formal interface contract for API conventions.
 *
 * Every convention (HAL, JSON API, etc.) must extend this class and implement
 * all methods. Methods throw if not implemented, failing fast instead of
 * silently returning undefined.
 *
 * Convention methods:
 *   - resolveAssociationFields: schema derivation (association → field definitions)
 *   - resolveAssociationValues: translate _id attrs to convention-specific fields before API submission
 *   - buildRequestPayload: format request body for the API
 *   - normalizeListResponse: extract records + pagination from API responses
 *   - cleanResponse: strip protocol metadata from API responses (e.g., _links for HAL)
 */
export class BaseConvention {
  get name() {
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
   *
   * @param {string} relName - Association name (e.g., 'title' for belongsTo, 'books' for hasMany)
   * @param {Object} relConfig - Association config from model (target_model, required, many, etc.)
   * @param {Object} [overrides] - Per-field overrides
   * @returns {Object} Field definitions keyed by field name
   */
  resolveAssociationFields(_relName, _relConfig, _overrides) {
    throw new Error(`${this.constructor.name} must implement resolveAssociationFields`)
  }

  /**
   * Resolve association _id attributes into convention-specific API fields.
   *
   * For HAL: title_id: 123 → title_link: 'https://api.../titles/123'
   * For JSON API: no-op (API accepts _id directly)
   *
   * @param {Object} attrs - Attribute key-value pairs
   * @param {Object} belongsTo - Model's belongsTo associations
   * @param {string} [apiBaseUrl] - API base URL for URL construction
   * @returns {Object} Attributes with resolved association fields
   */
  resolveAssociationValues(_attrs, _belongsTo, _apiBaseUrl) {
    throw new Error(`${this.constructor.name} must implement resolveAssociationValues`)
  }

  /**
   * Format attributes into the API's expected request body.
   *
   * HAL: flat attributes (server wraps).
   * JSON API: wrapped under model key { [model]: attrs }.
   *
   * @param {string} model - Singular model name
   * @param {Object} attrs - Attribute key-value pairs
   * @returns {Object} Formatted request payload
   */
  buildRequestPayload(_model, _attrs) {
    throw new Error(`${this.constructor.name} must implement buildRequestPayload`)
  }

  /**
   * Extract records and pagination from an API list response.
   *
   * @param {Object|Array} response - Raw API response
   * @param {Object} options - { page, perPage }
   * @returns {{ records: Object[], pagination: Object }}
   */
  normalizeListResponse(_response, _options) {
    throw new Error(`${this.constructor.name} must implement normalizeListResponse`)
  }

  /**
   * Strip protocol-specific metadata from an API response.
   * Applied at the API client boundary so all consumers receive clean data.
   * Default: no-op. Override in subclasses.
   * @param {*} data - Raw API response data
   * @returns {*} Cleaned response data
   */
  cleanResponse(data) {
    return data
  }
}
