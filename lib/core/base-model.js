/**
 * BaseModel - Base class for API model definitions
 *
 * Provides shared configuration and methods for all models.
 * Each model class defines its schema, attributes, and behavior.
 *
 * Models can be used in two ways:
 * 1. Static access for metadata: BookModel.endpoint, BookModel.required (derived from attributes)
 * 2. Instantiated with record data: new BookModel(record).displayValue
 */

import { jsonApiConvention } from '#lib/mcp/api-conventions/index.js'

export class BaseModel {
  // ============================================================================
  // STATIC PROPERTIES - Model metadata/configuration
  // ============================================================================

  /**
   * API endpoint for this model (e.g., 'books', 'study_sessions')
   * @type {string}
   */
  static endpoint = ''

  /**
   * Attribute definitions keyed by name
   * @type {Object<string, Object>}
   */
  static attributes = {}

  /**
   * Human-readable description of the model
   * @type {string}
   */
  static description = ''

  /**
   * API configuration: convention, readOnly, nested routing
   * @type {{ convention: Object, readOnly?: boolean, nested?: Object }}
   */
  static api = { convention: jsonApiConvention }

  /**
   * Search configuration. null means no search at all.
   * @type {{ fullText?: Object, filters?: Object, autocompleteFields?: string[] }|null}
   */
  static search = null

  /**
   * Related model associations
   * @type {{ belongsTo?: Object, hasMany?: Object }}
   */
  static associations = {}

  // ============================================================================
  // STATIC GETTERS - Computed metadata
  // ============================================================================

  /**
   * Get required attribute names (derived from attributes with required: true)
   * @returns {string[]}
   */
  static get required() {
    return Object.entries(this.attributes)
      .filter(([, config]) => config.required)
      .map(([name]) => name)
  }

  /**
   * Get default values for creation (derived from attributes with createDefault: true)
   * @returns {Object}
   */
  static get defaults() {
    return Object.fromEntries(
      Object.entries(this.attributes)
        .filter(([, config]) => config.createDefault)
        .map(([name, config]) => [name, config.default])
    )
  }

  /**
   * Get array of attribute names from the attributes object
   * @returns {string[]}
   */
  static get attributeNames() {
    return Object.keys(this.attributes)
  }

  /**
   * Get singular name for API payloads (e.g., 'books' -> 'book')
   * @returns {string}
   */
  static get singularName() {
    return this.endpoint.replace(/s$/, '')
  }

  /**
   * Check if this model supports autocomplete
   * @returns {boolean}
   */
  static get supportsAutocomplete() {
    return (
      Array.isArray(this.search?.autocompleteFields) && this.search.autocompleteFields.length > 0
    )
  }

  // ============================================================================
  // STATIC METHODS - Utilities that don't need instance data
  // ============================================================================

  /**
   * Build payload for create/update API calls
   * @param {Object} attrs - Attributes to include
   * @returns {Object} Wrapped payload
   */
  static buildPayload(attrs) {
    return { [this.singularName]: attrs }
  }

  /**
   * Validate required attributes for creation
   * @param {Object} attrs - Attributes to validate
   * @returns {{ valid: boolean, missing: string[] }}
   */
  static validateRequired(attrs) {
    const missing = this.required.filter((field) => !attrs[field])
    return { valid: missing.length === 0, missing }
  }

  /**
   * Get endpoint for a specific record
   * @param {string|number} id - Record ID
   * @returns {string}
   */
  static getRecordEndpoint(id) {
    return `${this.endpoint}/${id}`
  }

  // ============================================================================
  // CONSTRUCTOR - Instance creation with record data
  // ============================================================================

  /**
   * Create a model instance with record data
   * @param {Object} data - Record data from API
   */
  constructor(data = {}) {
    this.data = data
  }

  // ============================================================================
  // INSTANCE GETTERS - Convenient access to common fields
  // ============================================================================

  /**
   * Record ID
   * @returns {string|number|undefined}
   */
  get id() {
    return this.data.id
  }

  /**
   * Record name (if applicable)
   * @returns {string|undefined}
   */
  get name() {
    return this.data.name
  }

  /**
   * Self link URL
   * @returns {string|undefined}
   */
  get selfLink() {
    return this.data.self_link
  }

  // ============================================================================
  // INSTANCE METHODS - Behavior that operates on record data
  // ============================================================================

  /**
   * Get human-readable display value for this record
   * Override in subclasses for model-specific formatting
   * @returns {string}
   */
  get displayValue() {
    return this.data.name || this.data.title || `ID: ${this.data.id}`
  }

  /**
   * Get autocomplete result fields for this record
   * Override in subclasses for model-specific fields
   * @returns {Object}
   */
  get autocompleteFields() {
    return {}
  }

  /**
   * Get the API endpoint for this specific record
   * @returns {string}
   */
  get recordEndpoint() {
    return `${this.constructor.endpoint}/${this.id}`
  }

  /**
   * Build payload for updating this record
   * @param {Object} attrs - Attributes to update
   * @returns {Object} Wrapped payload
   */
  buildUpdatePayload(attrs) {
    return this.constructor.buildPayload(attrs)
  }

  /**
   * Get raw data for a specific attribute
   * @param {string} attr - Attribute name
   * @returns {*}
   */
  get(attr) {
    return this.data[attr]
  }

  /**
   * Convert to plain object (returns the raw data)
   * @returns {Object}
   */
  toJSON() {
    return this.data
  }
}
