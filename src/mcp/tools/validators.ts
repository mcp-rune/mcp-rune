/**
 * Generic validation functions for MCP tools.
 * These operate on any models registry passed as a parameter.
 */

import type { ModelsRegistry } from './base-tool.js'

// ============================================================================
// Types
// ============================================================================

export interface FilterSchema {
  type?: string
  enumValues?: string[]
  [key: string]: unknown
}

export interface SearchValidationSuccess {
  valid: true
}

export interface SearchValidationError {
  valid: false
  error: string
  searchableFields: string[]
  suggestion: string
}

export type SearchValidationResult = SearchValidationSuccess | SearchValidationError

interface LinkInfo {
  conditional?: string
  [key: string]: unknown
}

export interface NestedValidationSuccess {
  valid: true
  linkInfo?: LinkInfo
  type?: 'hasMany' | 'custom' | 'belongsTo'
  suggestion?: string | null
  warning?: string
}

export interface NestedValidationError {
  valid: false
  error: string
  availableLinks: string[]
  suggestion: string
}

export type NestedValidationResult = NestedValidationSuccess | NestedValidationError

// ============================================================================
// Functions
// ============================================================================

/**
 * Normalize enum filter values by splitting comma-separated strings into arrays.
 *
 * LLMs sometimes send multi-value enum filters as `"no_rights,conflicting,denied"`
 * instead of `["no_rights", "conflicting", "denied"]`. This function detects
 * comma-separated strings where each segment is a valid enum value and splits
 * them into proper arrays before validation and API dispatch.
 *
 * Non-enum filters and single-value strings are left unchanged.
 */
export function normalizeFilterValues(
  filters: Record<string, unknown> | undefined,
  filterSchema: Record<string, FilterSchema> | undefined
): Record<string, unknown> | undefined {
  if (!filters || !filterSchema) return filters

  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(filters)) {
    const schema = filterSchema[key]

    if (
      schema?.type === 'enum' &&
      schema.enumValues &&
      typeof value === 'string' &&
      value.includes(',')
    ) {
      const parts = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
      const allValid = parts.every((v) => schema.enumValues!.includes(v))

      if (allValid && parts.length > 1) {
        normalized[key] = parts
        continue
      }
    }

    normalized[key] = value
  }

  return normalized
}

/**
 * Validate filter values against the model's filter schema.
 *
 * Checks that enum filter values match the declared `enumValues` array.
 * Supports both single values (`rights_status: 'cleared'`) and arrays
 * (`rights_status: ['cleared', 'denied']`).
 *
 * When an invalid enum value matches a valid value on a *different* filter
 * of the same model, appends a "did you mean?" hint.
 */
export function validateFilterValues(
  model: string,
  filters: Record<string, unknown>,
  filterSchema: Record<string, FilterSchema>
): string | null {
  const errors: string[] = []

  for (const [key, value] of Object.entries(filters)) {
    const schema = filterSchema[key]
    if (!schema || schema.type !== 'enum' || !schema.enumValues) continue

    const values = Array.isArray(value) ? (value as string[]) : [value as string]
    const invalidValues = values.filter((v) => !schema.enumValues!.includes(v))

    if (invalidValues.length > 0) {
      const validList = schema.enumValues.map((v) => `\`${v}\``).join(', ')
      let msg = `Invalid value(s) for enum filter "${key}": ${invalidValues.map((v) => `"${v}"`).join(', ')}\nValid values: ${validList}`

      // "Did you mean?" -- check if invalid value is valid on another filter
      for (const invalidVal of invalidValues) {
        for (const [otherKey, otherSchema] of Object.entries(filterSchema)) {
          if (otherKey === key) continue
          if (otherSchema.type === 'enum' && otherSchema.enumValues?.includes(invalidVal)) {
            msg += `\n\nHint: "${invalidVal}" is a valid value for filter "${otherKey}". Did you mean ${otherKey}: "${invalidVal}"?`
          }
        }
      }

      errors.push(msg)
    }
  }

  if (errors.length > 0) {
    return (
      errors.join('\n\n') + `\n\nCall get_filters_guide("${model}") to see filter documentation.`
    )
  }

  return null
}

/**
 * Validate search parameters against a model's searchable fields
 */
export function validateSearchParams(
  model: string,
  searchParams: Record<string, unknown> | undefined,
  models: ModelsRegistry
): SearchValidationResult {
  const modelConfig = models[model]
  const searchableFields = modelConfig?.search?.autocompleteFields ?? []

  if (!searchParams || Object.keys(searchParams).length === 0) {
    return { valid: true }
  }

  const invalidFields = Object.keys(searchParams).filter(
    (field) => !searchableFields.includes(field)
  )

  if (invalidFields.length > 0) {
    return {
      valid: false,
      error: `The following search parameters are not supported for '${model}': ${invalidFields.join(', ')}`,
      searchableFields,
      suggestion:
        searchableFields.length > 0
          ? `Available searchable fields: ${searchableFields.join(', ')}\n\nTip: You can find specific records by ID using the 'id' parameter.`
          : `Model '${model}' does not support search parameters. Use 'id' to find specific records by their ID.`
    }
  }

  return { valid: true }
}

/**
 * Validate a nested resource relationship
 */
export function validateNestedResource(
  parentModel: string,
  childResource: string,
  models: ModelsRegistry
): NestedValidationResult {
  const parentConfig = models[parentModel]

  if (!parentConfig?.associations) {
    return { valid: true, warning: `No link metadata available for ${parentModel}` }
  }

  const assoc = parentConfig.associations

  // Check in hasMany
  if (assoc.hasMany?.[childResource]) {
    const linkInfo = assoc.hasMany[childResource] as unknown as LinkInfo
    return {
      valid: true,
      linkInfo,
      type: 'hasMany',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  // Check in custom associations
  const custom = (assoc as Record<string, unknown>).custom as
    | Record<string, LinkInfo>
    | undefined
  if (custom?.[childResource]) {
    const linkInfo = custom[childResource]!
    return {
      valid: true,
      linkInfo,
      type: 'custom',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  // Check in belongsTo (less common for nested resources, but possible)
  if (assoc.belongsTo?.[childResource]) {
    const linkInfo = assoc.belongsTo[childResource] as unknown as LinkInfo
    return {
      valid: true,
      linkInfo,
      type: 'belongsTo',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  // Not found - provide helpful suggestions
  const allLinks = [
    ...Object.keys(assoc.hasMany ?? {}),
    ...Object.keys(custom ?? {}),
    ...Object.keys(assoc.belongsTo ?? {})
  ]

  return {
    valid: false,
    error: `'${childResource}' is not a valid nested resource for ${parentModel}`,
    availableLinks: allLinks,
    suggestion:
      allLinks.length > 0
        ? `Available nested resources: ${allLinks.join(', ')}`
        : `No nested resources documented for ${parentModel}`
  }
}
