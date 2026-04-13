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

import type { BaseConvention, AssociationConfig } from '#src/mcp/api-conventions/base-convention.js'
import { jsonApiConvention } from '#src/mcp/api-conventions/index.js'

// ============================================================================
// Types
// ============================================================================

export interface AttributeDefinition {
  type: 'string' | 'integer' | 'boolean' | 'datetime' | 'enum' | 'text' | 'array'
  required?: boolean
  default?: unknown
  createDefault?: boolean
  description?: string
  enumValues?: string[]
  format?: string
  examples?: unknown[]
  items?: { type: string }
  label?: string
  validation?: Record<string, unknown>
  readOnly?: boolean
}

export interface SearchConfig {
  fullText?: {
    endpoint?: string
    group?: string
    modelName?: string | string[]
    adapter?: unknown
  }
  filters?: Record<string, unknown>
  autocompleteFields?: string[]
}

export interface NestedConfig {
  parent?: string | string[]
  nestedOnly?: boolean
  pathTemplate?: string
  parentKey?: string
}

export interface ApiConfig {
  convention?: BaseConvention
  readOnly?: boolean
  nested?: NestedConfig
}

export interface ModelData {
  id?: string | number
  name?: string
  title?: string
  self_link?: string
  [key: string]: unknown
}

// ============================================================================
// BaseModel
// ============================================================================

export class BaseModel {
  static endpoint: string = ''
  static attributes: Record<string, AttributeDefinition> = {}
  static description: string = ''
  static api: ApiConfig = { convention: jsonApiConvention }
  static search: SearchConfig | null = null
  static associations: AssociationConfig = {}

  // --- Static getters ---

  /** Required attribute names (derived from attributes with required: true) */
  static get required(): string[] {
    return Object.entries(this.attributes)
      .filter(([, config]) => config.required)
      .map(([name]) => name)
  }

  /** Default values for creation (derived from attributes with createDefault: true) */
  static get defaults(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(this.attributes)
        .filter(([, config]) => config.createDefault)
        .map(([name, config]) => [name, config.default])
    )
  }

  /** Array of attribute names */
  static get attributeNames(): string[] {
    return Object.keys(this.attributes)
  }

  /** Singular name for API payloads (e.g., 'books' -> 'book') */
  static get singularName(): string {
    return this.endpoint.replace(/s$/, '')
  }

  /** Check if this model supports autocomplete */
  static get supportsAutocomplete(): boolean {
    return (
      Array.isArray(this.search?.autocompleteFields) && this.search!.autocompleteFields!.length > 0
    )
  }

  // --- Static methods ---

  /** Build payload for create/update API calls */
  static buildPayload(attrs: Record<string, unknown>): Record<string, unknown> {
    return { [this.singularName]: attrs }
  }

  /** Validate required attributes for creation */
  static validateRequired(attrs: Record<string, unknown>): { valid: boolean; missing: string[] } {
    const missing = this.required.filter((field) => !attrs[field])
    return { valid: missing.length === 0, missing }
  }

  /** Get endpoint for a specific record */
  static getRecordEndpoint(id: string | number): string {
    return `${this.endpoint}/${id}`
  }

  // --- Instance ---

  data: ModelData

  constructor(data: ModelData = {}) {
    this.data = data
  }

  get id(): string | number | undefined {
    return this.data.id
  }

  get name(): string | undefined {
    return this.data.name
  }

  get selfLink(): string | undefined {
    return this.data.self_link
  }

  /** Human-readable display value. Override in subclasses for model-specific formatting. */
  get displayValue(): string {
    return this.data.name || this.data.title || `ID: ${this.data.id}`
  }

  /** Autocomplete result fields. Override in subclasses. */
  get autocompleteFields(): Record<string, unknown> {
    return {}
  }

  /** API endpoint for this specific record */
  get recordEndpoint(): string {
    return `${(this.constructor as typeof BaseModel).endpoint}/${this.id}`
  }

  /** Build payload for updating this record */
  buildUpdatePayload(attrs: Record<string, unknown>): Record<string, unknown> {
    return (this.constructor as typeof BaseModel).buildPayload(attrs)
  }

  /** Get raw data for a specific attribute */
  get(attr: string): unknown {
    return this.data[attr]
  }

  /** Convert to plain object (returns the raw data) */
  toJSON(): ModelData {
    return this.data
  }
}
