/**
 * Pure helpers behind `DataLayer.validateFilters`, `normalizeFilters`,
 * and `validateNestedResource`. Names reflect what each call compares
 * against — filterable attributes (the search-extension config bag) or
 * model associations (`belongsTo` / `hasMany` / `custom`).
 *
 * Not exported from `src/tools.ts`. Projection-layer callers reach these
 * through the `DataLayer` seam; tests can import them directly.
 */

import { getSearchConfig } from '#src/mcp/data-layer/api-extensions/search/capabilities.js'

import type { ModelsRegistry } from '../tools/base-tool.js'
import type {
  FilterableAttribute,
  FilterValidationResult,
  LinkInfo,
  NestedValidationResult
} from './data-layer.js'

/** Resolve the filterable-attribute map declared on a model's search config. */
export function resolveFilterableAttributes(
  model: string,
  models: ModelsRegistry
): Record<string, FilterableAttribute> {
  const modelConfig = models[model]
  return (modelConfig ? (getSearchConfig(modelConfig)?.filters ?? {}) : {}) as Record<
    string,
    FilterableAttribute
  >
}

/**
 * Split comma-separated enum strings against each `FilterableAttribute.enumValues`,
 * leaving non-enum filters and unrecognized strings untouched.
 *
 * LLMs sometimes pack multi-value enum filters as `"a,b,c"` instead of `["a","b","c"]`.
 */
export function normalizeFiltersAgainstAttributes(
  filters: Record<string, unknown> | undefined,
  filterableAttributes: Record<string, FilterableAttribute> | undefined
): Record<string, unknown> | undefined {
  if (!filters || !filterableAttributes) return filters

  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(filters)) {
    const attr = filterableAttributes[key]

    if (
      attr?.type === 'enum' &&
      attr.enumValues &&
      typeof value === 'string' &&
      value.includes(',')
    ) {
      const parts = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
      const allValid = parts.every((v) => attr.enumValues!.includes(v))

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
 * Check each filter value against its `FilterableAttribute.enumValues`.
 *
 * Supports single values and arrays. When an invalid value matches a valid
 * value on a *different* filter for the same model, appends a "did you mean?" hint.
 */
export function checkFilterValuesAgainstEnums(
  model: string,
  filters: Record<string, unknown>,
  filterableAttributes: Record<string, FilterableAttribute>
): string | null {
  const errors: string[] = []

  for (const [key, value] of Object.entries(filters)) {
    const attr = filterableAttributes[key]
    if (!attr || attr.type !== 'enum' || !attr.enumValues) continue

    const values = Array.isArray(value) ? (value as string[]) : [value as string]
    const invalidValues = values.filter((v) => !attr.enumValues!.includes(v))

    if (invalidValues.length > 0) {
      const validList = attr.enumValues.map((v) => `\`${v}\``).join(', ')
      let msg = `Invalid value(s) for enum filter "${key}": ${invalidValues.map((v) => `"${v}"`).join(', ')}\nValid values: ${validList}`

      for (const invalidVal of invalidValues) {
        for (const [otherKey, otherAttr] of Object.entries(filterableAttributes)) {
          if (otherKey === key) continue
          if (otherAttr.type === 'enum' && otherAttr.enumValues?.includes(invalidVal)) {
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
 * Check that every key in `filters` is declared as a filterable attribute on
 * `model`, then check enum values against each attribute's `enumValues`.
 * Normalizes comma-separated enum strings into arrays.
 *
 * Returns the normalized filter object on success so the caller can pass it
 * straight to the data fetch.
 */
export function checkFiltersAgainstAttributes(
  model: string,
  filters: Record<string, unknown> | undefined,
  models: ModelsRegistry
): FilterValidationResult {
  const filterableAttributes = resolveFilterableAttributes(model, models)

  if (!filters || Object.keys(filters).length === 0) {
    return { valid: true }
  }

  const availableFilters = Object.keys(filterableAttributes)
  if (availableFilters.length === 0) {
    return {
      valid: false,
      error: `Model '${model}' does not support search filters.`,
      availableFilters: [],
      suggestion: `This model does not have filter support configured. Use find_records to retrieve records by ID.`
    }
  }

  const normalizedFilters = normalizeFiltersAgainstAttributes(filters, filterableAttributes)!

  const unknownFilters = Object.keys(normalizedFilters).filter((f) => !filterableAttributes[f])
  if (unknownFilters.length > 0) {
    return {
      valid: false,
      error: `Unknown filter(s) for ${model}: ${unknownFilters.join(', ')}`,
      availableFilters,
      suggestion: `Available filters: ${availableFilters.join(', ')}\n\nCall get_filters_guide("${model}") to see filter documentation.`
    }
  }

  const enumError = checkFilterValuesAgainstEnums(model, normalizedFilters, filterableAttributes)
  if (enumError) {
    return {
      valid: false,
      error: enumError,
      availableFilters,
      suggestion: `Call get_filters_guide("${model}") to see valid filter values.`
    }
  }

  return { valid: true, filters: normalizedFilters }
}

/**
 * Check a nested-resource name against the parent model's declared
 * associations (`belongsTo` / `hasMany` / `custom`).
 */
export function checkLinkAgainstAssociations(
  parentModel: string,
  childResource: string,
  models: ModelsRegistry
): NestedValidationResult {
  const parentConfig = models[parentModel]

  if (!parentConfig?.associations) {
    return { valid: true, warning: `No link metadata available for ${parentModel}` }
  }

  const assoc = parentConfig.associations

  if (assoc.hasMany?.[childResource]) {
    const linkInfo = assoc.hasMany[childResource] as unknown as LinkInfo
    return {
      valid: true,
      linkInfo,
      type: 'hasMany',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  const custom = (assoc as Record<string, unknown>).custom as Record<string, LinkInfo> | undefined
  if (custom?.[childResource]) {
    const linkInfo = custom[childResource]!
    return {
      valid: true,
      linkInfo,
      type: 'custom',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  if (assoc.belongsTo?.[childResource]) {
    const linkInfo = assoc.belongsTo[childResource] as unknown as LinkInfo
    return {
      valid: true,
      linkInfo,
      type: 'belongsTo',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

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
