/**
 * Shared type definitions for MCP App modules.
 *
 * These extend the base model types with app-specific properties
 * (display visibility, derived fields, etc.) that the base model
 * layer does not know about.
 */

import type { AssociationConfig, BaseConvention } from '#src/mcp/api-conventions/base-convention.js'
import type { SearchService } from '#src/mcp/search/search-service.js'
import type { SearchApiClient } from '#src/mcp/search/types.js'

import type { FormDataStore } from './form-data-store.js'
import type { SelectionStore } from './selection-store.js'

// Re-export for convenience — apps only need get/post
export type { SearchApiClient as ApiClient } from '#src/mcp/search/types.js'

/**
 * Extended attribute definition used in app schema generators.
 * Adds display-layer properties not present in the core AttributeDefinition.
 */
export interface AppAttributeDefinition {
  type?: string
  required?: boolean
  default?: unknown
  description?: string
  enumValues?: string[]
  format?: string
  examples?: unknown[]
  items?: { type: string }
  label?: string
  validation?: Record<string, unknown>
  readOnly?: boolean
  /** Whether the field appears in prompts (defaults to true) */
  prompt_visible?: boolean
  /** Whether the field appears in list views (defaults to true) */
  list_visible?: boolean
  /** Derived field configuration */
  derived?: { from: string; field: string }
  /** Conditional visibility rules */
  visibleWhen?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Model class interface as seen by MCP Apps.
 * Extends the static shape of BaseModel with app-specific metadata.
 */
export interface AppModelClass {
  new (data?: Record<string, unknown>): AppModelInstance
  singularName: string
  attributes: Record<string, AppAttributeDefinition>
  associations?: AssociationConfig
  search?: {
    lookup?: {
      endpoint?: string
      fields: string[]
      queryParam?: string
    }
    query?: {
      endpoint?: string
      group?: string
      modelName?: string | string[]
      adapter?: unknown
      [key: string]: unknown
    }
    filters?: Record<string, unknown>
    [key: string]: unknown
  }
  api: {
    endpoint: string
    convention?: BaseConvention
    readOnly?: boolean
    parent?: string | string[]
    standalone?: boolean
    [key: string]: unknown
  }
  supportsLookup: boolean
  defaultColumns?: string[]
  description?: string
  [key: string]: unknown
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
  apiClient?: SearchApiClient
  searchClient?: SearchService
  selectionStore?: SelectionStore
  formDataStore?: FormDataStore
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
}

/** Field definition for form schemas */
export interface FormFieldDefinition {
  name: string
  label: string
  group: string
  required: boolean
  type: string
  description?: string
  placeholder?: string
  default?: unknown
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

/** Fieldset definition for form/detail schemas */
export interface FieldsetDefinition {
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

/** Form schema shape */
export interface FormSchema {
  model: string
  title: string
  fieldsets: FieldsetDefinition[]
  fields: FormFieldDefinition[]
  groupLayouts?: Record<string, unknown>
}

/** Detail schema shape */
export interface DetailSchema {
  model: string
  title: string
  endpoint: string
  fields: DetailFieldDefinition[]
}
