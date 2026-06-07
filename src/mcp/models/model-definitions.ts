import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

export interface CompletionConfig {
  enabled?: boolean
  provider?: string
  target_model?: string
  search_fields?: string[]
  display_template?: string
  value_field?: string
  [key: string]: unknown
}

export interface AttributeDefinition {
  type: 'string' | 'integer' | 'boolean' | 'datetime' | 'enum' | 'text' | 'array'
  required?: boolean
  default?: unknown
  createDefault?: boolean
  description?: string
  enumValues?: string[]
  enumDescriptions?: Record<string, string>
  format?: string
  examples?: string[]
  items?: { type: string }
  label?: string
  validation?: Record<string, unknown>
  readOnly?: boolean
  /** Whether the field appears in prompts (defaults to true). Read by schema-derivation. */
  prompt_visible?: boolean
  /** Whether the field appears in list views (defaults to true). */
  list_visible?: boolean
  /** Derived field configuration; resolved before display. */
  derived?: { from: string; field: string }
  /** Conditional visibility rules — opaque key/value pairs evaluated by the form runtime. */
  visibleWhen?: Record<string, unknown>
  /** Per-attribute completion config consumed by the MCP `complete` handler. */
  completion?: CompletionConfig
}

/** Map of attribute name → definition. Symmetric counterpart to AssociationConfig. */
export type AttributesConfig = Record<string, AttributeDefinition>

export interface BelongsToAssociation {
  target_model: string
  required?: boolean
  description?: string
  endpoint?: string
  autocomplete?: boolean
}

export interface HasManyAssociation {
  target_model: string
  required?: boolean
  many: true
  description?: string
  autocomplete?: boolean
}

export interface AssociationConfig {
  belongsTo?: Record<string, BelongsToAssociation>
  hasMany?: Record<string, HasManyAssociation>
}

/** Per-action endpoint overrides for models with non-standard API paths. */
export interface EndpointOverrides {
  /** Override for collection operations (list, create). */
  collection?: string
  /** Override for record operations (find, update, delete) — use :id for record ID. */
  record?: string
  /** Action-specific overrides — take highest priority. */
  create?: string
  update?: string
  delete?: string
}

export interface ApiConfig {
  /** Base API path for this model (e.g., 'books', 'activities'). */
  endpoint: string
  convention?: BaseConvention
  readOnly?: boolean
  /** Parent model name(s) for nested resources. */
  parent?: string | string[]
  /** Whether the model has a standalone (non-nested) endpoint. Default: true. */
  standalone?: boolean
  /** API namespace prefix (e.g., 'api/v1'). Overrides server-wide default. */
  namespace?: string
  /** Per-action endpoint overrides for non-standard API paths. */
  endpoints?: EndpointOverrides
}
