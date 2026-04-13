/**
 * Generic validation functions for MCP tools.
 * These operate on any models registry passed as a parameter.
 */

/**
 * Normalize enum filter values by splitting comma-separated strings into arrays.
 *
 * LLMs sometimes send multi-value enum filters as `"no_rights,conflicting,denied"`
 * instead of `["no_rights", "conflicting", "denied"]`. This function detects
 * comma-separated strings where each segment is a valid enum value and splits
 * them into proper arrays before validation and API dispatch.
 *
 * Non-enum filters and single-value strings are left unchanged.
 *
 * @param {Object} filters - Provided filter key-value pairs
 * @param {Object} filterSchema - Model's filter declarations (from `Model.search.filters`)
 * @returns {Object} New filters object with comma-separated enum strings split into arrays
 */
export function normalizeFilterValues(filters, filterSchema) {
  if (!filters || !filterSchema) return filters

  const normalized = {}

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
      const allValid = parts.every((v) => schema.enumValues.includes(v))

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
 *
 * @param {string} model - Model name (for error messages)
 * @param {Object} filters - Provided filter key-value pairs
 * @param {Object} filterSchema - Model's filter declarations (from `Model.search.filters`)
 * @returns {string|null} Error message or null if all values are valid
 */
export function validateFilterValues(model, filters, filterSchema) {
  const errors = []

  for (const [key, value] of Object.entries(filters)) {
    const schema = filterSchema[key]
    if (!schema || schema.type !== 'enum' || !schema.enumValues) continue

    const values = Array.isArray(value) ? value : [value]
    const invalidValues = values.filter((v) => !schema.enumValues.includes(v))

    if (invalidValues.length > 0) {
      const validList = schema.enumValues.map((v) => `\`${v}\``).join(', ')
      let msg = `Invalid value(s) for enum filter "${key}": ${invalidValues.map((v) => `"${v}"`).join(', ')}\nValid values: ${validList}`

      // "Did you mean?" — check if invalid value is valid on another filter
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
 * @param {string} model - Model name
 * @param {Object} searchParams - Search parameters to validate
 * @param {Object} models - Models registry (model name → config)
 * @returns {Object} Validation result with valid flag and error details
 */
export function validateSearchParams(model, searchParams, models) {
  const modelConfig = models[model]
  const searchableFields = modelConfig?.search?.autocompleteFields || []

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
 * @param {string} parentModel - Parent model name
 * @param {string} childResource - Child resource name
 * @param {Object} models - Models registry (model name → config)
 * @returns {Object} Validation result with link info or error details
 */
export function validateNestedResource(parentModel, childResource, models) {
  const parentConfig = models[parentModel]

  if (!parentConfig?.associations) {
    return { valid: true, warning: `No link metadata available for ${parentModel}` }
  }

  const assoc = parentConfig.associations

  // Check in hasMany
  if (assoc.hasMany && assoc.hasMany[childResource]) {
    const linkInfo = assoc.hasMany[childResource]
    return {
      valid: true,
      linkInfo,
      type: 'hasMany',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  // Check in custom associations
  if (assoc.custom && assoc.custom[childResource]) {
    const linkInfo = assoc.custom[childResource]
    return {
      valid: true,
      linkInfo,
      type: 'custom',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  // Check in belongsTo (less common for nested resources, but possible)
  if (assoc.belongsTo && assoc.belongsTo[childResource]) {
    const linkInfo = assoc.belongsTo[childResource]
    return {
      valid: true,
      linkInfo,
      type: 'belongsTo',
      suggestion: linkInfo.conditional ? `Note: ${linkInfo.conditional}` : null
    }
  }

  // Not found - provide helpful suggestions
  const allLinks = [
    ...Object.keys(assoc.hasMany || {}),
    ...Object.keys(assoc.custom || {}),
    ...Object.keys(assoc.belongsTo || {})
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
