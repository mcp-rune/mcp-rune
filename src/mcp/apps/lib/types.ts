/**
 * Shared type definitions for MCP App modules.
 *
 * These extend the base model types with app-specific properties
 * (display visibility, derived fields, etc.) that the base model
 * layer does not know about.
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'
import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'
import type { ApiConfig } from '#src/mcp/models/api-config.js'
import type { AssociationConfig } from '#src/mcp/models/association-config.js'
import type { AttributeDefinition } from '#src/mcp/models/attribute-definition.js'

import type { AppFormDataStore } from './app-form-data-store.js'
import type { SelectionStore } from './selection-store.js'

// Re-exported for AppRegistry consumers wiring up the createApiClient factory.
export type { ApiClient } from '#src/core/api-client.js'
export type { DataLayer } from '#src/mcp/data-layer/data-layer.js'

/**
 * Attribute definition as seen by MCP Apps. Alias of the canonical
 * `AttributeDefinition` so app schema generators and the model layer share
 * one shape — any field that needs to be visible to apps belongs on
 * `AttributeDefinition`.
 */
export type AppAttributeDefinition = AttributeDefinition

/**
 * Model class interface as seen by MCP Apps. Aligned with the static shape
 * of `BaseModel` so that `typeof MyModel` (a `BaseModel` subclass) is
 * directly assignable without an explicit cast.
 */
export interface AppModelClass {
  new (data?: Record<string, unknown>): AppModelInstance
  singularName: string
  attributes: Record<string, AttributeDefinition>
  associations?: AssociationConfig
  /**
   * Opt-in extension configs, keyed by extension name. Apps read search
   * config via `getSearchConfig(ModelClass)` from the search extension —
   * no direct `.search.*` access.
   */
  extensions?: Record<string, unknown>
  api: ApiConfig & { convention?: BaseConvention }
  defaultColumns?: string[]
  description?: string
}

export interface AppModelInstance {
  data: Record<string, unknown>
  id?: string | number
  displayValue: string
  lookupFields: Record<string, unknown>
}

/** Tool call result shape from MCP SDK */
export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
  _meta?: Record<string, unknown>
}

/** Context passed to handleToolCall by AppRegistry */
export interface AppToolContext {
  dataLayer?: DataLayer
  selectionStore?: SelectionStore
  formDataStore?: AppFormDataStore
}

/** Column definition for list/search schemas */
export interface ColumnDefinition {
  name: string
  label: string
  type: string
  sortable: boolean
  enumValues?: string[]
  derived?: { from: string; field: string }
  enumHints?: Record<string, { icon?: string; className?: string }>
  /** Optional format discriminator (e.g. 'URL', 'rating', 'isbn') for formatter narrowing. */
  format?: string
}

/** Field definition for app form schemas */
export interface AppFormFieldDefinition {
  name: string
  label: string
  group: string
  required: boolean
  type: string
  description?: string
  placeholder?: string
  default?: unknown
  /**
   * Model attribute kind ('string', 'integer', 'boolean', 'date', 'datetime', …).
   * Distinct from `type`, which is the HTML widget type. Used by the bidirectional
   * formatter registry to apply parse/format/toInput/fromInput/serialize.
   */
  kind?: string
  options?: Array<{ value: string; label: string; color?: string }>
  association?: {
    endpoint: string
    labelField: string
    valueField?: string
    convention?: BaseConvention
    nested?: { parentModel: string; childEndpoint: string }
  }
  validation?: Record<string, unknown>
  visibleWhen?: Record<string, unknown>
  enumValues?: string[]
  format?: string
}

/** Detail field definition */
export interface DetailFieldDefinition {
  name: string
  label: string
  type: string
  format?: string
  enumValues?: string[]
  validation?: Record<string, unknown>
  association?: {
    endpoint: string
    labelField: string
  }
}

/** Fieldset definition for app form/detail schemas */
export interface AppFormFieldsetDefinition {
  key: string
  title: string
  description: string
  required: boolean
  groups: string[]
}

/** List schema shape */
export interface ListSchema {
  model: string
  title: string
  endpoint: string
  columns: ColumnDefinition[]
  searchFields: string[]
}

/** App form schema shape */
export interface AppFormSchema {
  model: string
  title: string
  fieldsets: AppFormFieldsetDefinition[]
  fields: AppFormFieldDefinition[]
  groupLayouts?: Record<string, unknown>
}

/** Detail schema shape */
export interface DetailSchema {
  model: string
  title: string
  endpoint: string
  fields: DetailFieldDefinition[]
}
