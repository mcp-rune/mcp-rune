/**
 * AttributeDefinition — canonical shape of a single model attribute.
 *
 * Lives in the model domain so every layer (data, model, analysis, prompts,
 * apps, tools) consumes a single source of truth.
 */

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
