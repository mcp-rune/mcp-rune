/**
 * BaseModel - Base class for API model definitions
 *
 * Provides shared configuration and methods for all models.
 * Each model class defines its schema, attributes, and behavior.
 *
 * Models can be used in two ways:
 * 1. Static access for metadata: BookModel.api.endpoint, BookModel.required (derived from attributes)
 * 2. Instantiated with record data: new BookModel(record).displayValue
 */

import { jsonApiConvention } from '#src/mcp/data-layer/api-conventions/index.js'

import type { ApiConfig } from './api-config.js'
import type { AssociationConfig } from './association-config.js'
import type { AttributesConfig } from './attribute-definition.js'

export interface ModelData {
  id?: string | number
  name?: string
  title?: string
  self_link?: string
  [key: string]: unknown
}

export class BaseModel {
  static modelName?: string
  static attributes: AttributesConfig = {}
  static description: string = ''
  static api: ApiConfig = { endpoint: '', convention: jsonApiConvention }
  static associations: AssociationConfig = {}
  /**
   * Opt-in extension configs, keyed by extension name.
   *
   * Each registered `ApiExtension` reads its own slice via a typed helper it
   * exports (e.g. `customActionsConfig({...})`). Authors should never write
   * raw object literals here — always use the helper, which provides full
   * type safety at the call site.
   *
   * See `docs/guides/api-extensions.md` for the rationale.
   */
  static extensions: Record<string, unknown> = {}

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

  /** Singular name for API payloads (e.g., 'books' -> 'book'). Override with `static modelName`. */
  static get singularName(): string {
    return this.modelName ?? this.api.endpoint!.replace(/s$/, '')
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
    return `${this.api.endpoint}/${id}`
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

  /** Lookup result fields for display. Override in subclasses. */
  get lookupFields(): Record<string, unknown> {
    return {}
  }

  /** API endpoint for this specific record */
  get recordEndpoint(): string {
    return `${(this.constructor as typeof BaseModel).api.endpoint}/${this.id}`
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
