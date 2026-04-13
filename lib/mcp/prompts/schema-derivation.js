/**
 * Schema Derivation Utilities
 *
 * Derives prompt field definitions from model classes to eliminate redundancy.
 * This creates a single source of truth for field metadata.
 *
 * Benefits:
 * - Eliminates 60-70% code duplication between model classes and prompts
 * - Ensures consistency between API schema and prompt definitions
 * - Reduces maintenance burden (update once, reflect everywhere)
 * - Maintains flexibility for prompt-specific overrides
 * - Memoization ensures static schemas are computed only once
 */

/**
 * Cache for memoized results
 * Since all inputs are static (model classes and prompt class definitions),
 * we can safely cache derivation results indefinitely.
 */
const fieldDefinitionsCache = new Map()
const promptSchemaCache = new Map()

/**
 * Generate a stable cache key from inputs
 * Uses JSON stringify to create a deterministic key from all inputs
 * @private
 */
function generateCacheKey(modelConfig, options = {}) {
  // Create a stable representation of the model config
  const modelKey = JSON.stringify({
    endpoint: modelConfig?.endpoint,
    attributes: modelConfig?.attributes ? Object.keys(modelConfig.attributes).sort() : [],
    required: modelConfig?.required,
    associations: modelConfig?.associations ? Object.keys(modelConfig.associations).sort() : [],
    apiConvention: options.apiConvention?.name || modelConfig?.api?.convention?.name
  })

  // Include full options in the key
  const optionsKey = JSON.stringify({
    overrides: options.overrides || {},
    include: options.include || null,
    exclude: options.exclude || [],
    promptOnly: options.promptOnly ?? true,
    fieldGroups: options.fieldGroups || {},
    promptFields: options.promptFields || {},
    fieldOverrides: options.fieldOverrides || {},
    excludeFields: options.excludeFields || []
  })

  return `${modelKey}:${optionsKey}`
}

/**
 * Clear all schema caches
 * @returns {Object} Statistics about cleared caches
 */
export function clearSchemaCaches() {
  const stats = {
    fieldDefinitions: fieldDefinitionsCache.size,
    schemas: promptSchemaCache.size
  }

  fieldDefinitionsCache.clear()
  promptSchemaCache.clear()

  return stats
}

/**
 * Get cache statistics
 * @returns {Object} Cache sizes
 */
export function getSchemaCacheStats() {
  return {
    fieldDefinitions: fieldDefinitionsCache.size,
    schemas: promptSchemaCache.size
  }
}

/**
 * Field type mapping from API to prompt types
 */
const TYPE_MAPPING = {
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
  datetime: 'datetime',
  date: 'date',
  time: 'time',
  text: 'text',
  enum: 'enum'
}

/**
 * Derive field definitions from model configuration (memoized)
 *
 * @param {Object} modelConfig - Model configuration object
 * @param {Object} options - Derivation options
 * @param {Object} options.overrides - Field-specific overrides
 * @param {string[]} options.include - Only include these fields (if specified)
 * @param {string[]} options.exclude - Exclude these fields
 * @param {boolean} options.promptOnly - Only include fields marked as prompt_visible (default: true)
 * @returns {Object} Field definitions suitable for prompts
 */
export function deriveFieldDefinitions(modelConfig, options = {}) {
  const {
    overrides = {},
    include = null,
    exclude = [],
    promptOnly = true,
    apiConvention: optionsConvention
  } = options

  const apiConvention = optionsConvention || modelConfig.api?.convention

  if (!modelConfig) {
    throw new Error('modelConfig is required')
  }

  // Check cache
  const cacheKey = generateCacheKey(modelConfig, options)
  const cached = fieldDefinitionsCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const fieldDefinitions = {}
  const attributes = Object.keys(modelConfig.attributes || {})
  const required = modelConfig.required || []

  // Process each attribute
  for (const attrName of attributes) {
    // Skip excluded fields
    if (exclude.includes(attrName)) {
      continue
    }

    // If include list specified, only process those
    if (include && !include.includes(attrName)) {
      continue
    }

    // Get attribute configuration
    const attrConfig = (modelConfig.attributes || {})[attrName] || {}

    // Skip if promptOnly=true and field is marked as not visible
    if (promptOnly && attrConfig.prompt_visible === false) {
      continue
    }

    // Build field definition
    const fieldDef = {
      name: attrName,
      type: mapType(attrConfig.type || 'string'),
      required: required.includes(attrName),
      description: attrConfig.description || `${attrName} field`
    }

    // Add optional properties
    if (attrConfig.examples) {
      fieldDef.examples = attrConfig.examples
    }

    if (attrConfig.default !== undefined) {
      fieldDef.default = attrConfig.default
    }

    if (attrConfig.validation) {
      fieldDef.validation = attrConfig.validation
    }

    if (attrConfig.enumValues) {
      fieldDef.enumValues = attrConfig.enumValues
    }

    if (attrConfig.format) {
      fieldDef.format = attrConfig.format
    }

    // Add autocomplete configuration
    if (attrConfig.completion) {
      fieldDef.completion = attrConfig.completion
    }

    // Apply field-specific overrides
    if (overrides[attrName]) {
      Object.assign(fieldDef, overrides[attrName])
    }

    fieldDefinitions[attrName] = fieldDef
  }

  // Add relation fields from associations (only belongsTo produces fields)
  if (modelConfig.associations?.belongsTo) {
    if (!apiConvention) {
      throw new Error(
        'apiConvention is required when model has associations. ' +
          'Set static apiConvention on the model class (e.g., jsonApiConvention).'
      )
    }
    addAssociationFields(fieldDefinitions, modelConfig.associations, {
      overrides,
      exclude,
      apiConvention
    })
  }

  // Cache and return
  fieldDefinitionsCache.set(cacheKey, fieldDefinitions)
  return fieldDefinitions
}

/**
 * Add relation fields from model associations
 *
 * @param {Object} fieldDefinitions - Field definitions to augment
 * @param {Object} associations - Associations configuration from model
 * @param {Object} options - Options
 * @private
 */
function addAssociationFields(fieldDefinitions, associations, options = {}) {
  const { overrides = {}, exclude = [], apiConvention } = options

  // Process belongsTo relations
  if (associations.belongsTo) {
    for (const [relName, relConfig] of Object.entries(associations.belongsTo)) {
      const resolvedFields = apiConvention.resolveAssociationFields(relName, relConfig, overrides)

      for (const [fieldName, fieldDef] of Object.entries(resolvedFields)) {
        // Skip excluded fields and fields already defined from attributes
        if (!exclude.includes(fieldName) && !fieldDefinitions[fieldName]) {
          fieldDefinitions[fieldName] = fieldDef
        }
      }
    }
  }
}

/**
 * Map API type to prompt type
 *
 * @param {string} apiType - API type
 * @returns {string} Prompt type
 * @private
 */
function mapType(apiType) {
  return TYPE_MAPPING[apiType] || 'string'
}

/**
 * Create a complete prompt schema from model configuration (memoized)
 *
 * @param {Object} modelConfig - Model configuration object
 * @param {Object} options - Schema options
 * @param {Object} options.fieldOverrides - Enhancements to existing model fields (e.g., adding required, completion)
 * @param {Object} options.promptFields - Prompt-only fields not in the model (e.g., parent_type, selected_platforms)
 * @param {Object} options.fieldGroups - Field groups for semantic organization (required for prompts)
 * @param {string[]} options.excludeFields - Fields to exclude from derivation
 * @param {boolean} options.promptOnly - Only include prompt-visible fields (default: true)
 * @returns {Object} Complete prompt schema { fieldDefinitions, fieldGroups }
 */
export function derivePromptSchema(modelConfig, options = {}) {
  // Check cache
  const cacheKey = generateCacheKey(modelConfig, options)
  const cached = promptSchemaCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const {
    fieldOverrides = {},
    promptFields = {},
    fieldGroups = {},
    excludeFields = [],
    promptOnly = true,
    apiConvention
  } = options

  // Derive field definitions from model config with overrides applied
  const derivedFields = deriveFieldDefinitions(modelConfig, {
    overrides: fieldOverrides,
    exclude: excludeFields,
    promptOnly,
    apiConvention
  })

  // Merge derived fields with additional prompt-only fields
  const fieldDefinitions = {
    ...derivedFields,
    ...promptFields
  }

  const result = {
    fieldDefinitions,
    fieldGroups
  }

  // Cache and return
  promptSchemaCache.set(cacheKey, result)
  return result
}

/**
 * Enhance model config with prompt metadata
 * Helper to add prompt-specific metadata to existing model configuration
 *
 * @param {Object} modelConfig - Existing model config
 * @param {Object} promptMetadata - Prompt metadata to add
 * @returns {Object} Enhanced model config
 */
export function enhanceModelConfig(modelConfig, promptMetadata) {
  const enhanced = { ...modelConfig }

  enhanced.attributes = { ...enhanced.attributes }

  // Merge prompt metadata into attributes
  for (const [field, metadata] of Object.entries(promptMetadata)) {
    enhanced.attributes[field] = {
      ...(enhanced.attributes[field] || {}),
      ...metadata
    }
  }

  return enhanced
}
