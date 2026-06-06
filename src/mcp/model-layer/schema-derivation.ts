/**
 * Prompt Schema Derivation — turn a model's `static attributes` (plus
 * convention-resolved association fields) into the `PromptFieldDefinition`
 * map a prompt strategy consumes.
 *
 *   class Book extends BaseModel {
 *     static attributes = {
 *       title: { type: 'string',  required: true,  description: 'Book title' },
 *       year:  { type: 'integer', prompt_visible: false },                       // ← skipped (prompt_visible: false)
 *       genre: { type: 'enum',    enumValues: ['fiction', 'non-fiction'] }
 *     }
 *     static associations = {
 *       belongsTo: { author: { target_model: 'author' } }                        // ← convention emits author_id field
 *     }
 *     static api = { convention: jsonApiConvention }
 *   }
 *
 *   derivePromptSchema(Book) →
 *     { fieldDefinitions: {
 *         title:  { type: 'string',  required: true,  description: 'Book title' },
 *         genre:  { type: 'enum',    required: false, enumValues: [...] },
 *         author_id: { type: 'string', required: false, description: '…' } } }
 *
 * Reads `type`, `format`, `required`, `description`, `prompt_visible`, and
 * `enumValues` from each attribute, then calls the model's API convention
 * to resolve association → field mappings. Memoized: the inputs are static
 * at boot, so each `(modelConfig, options)` pair derives at most once.
 * Reached through `modelLayer.promptSchema(options)` after PR2.
 */

import type {
  AssociationConfig,
  BaseConvention,
  FieldDefinition
} from '#src/mcp/data-layer/api-conventions/base-convention.js'
import type { AttributeDefinition } from '#src/mcp/models/base-model.js'
import { getKind } from '#src/mcp/models/kinds/index.js'
import type { FieldGroup, PromptFieldDefinition } from '#src/mcp/prompts/base-prompt.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structural view of a model configuration as consumed by schema derivation.
 * Aligned with `typeof BaseModel` so both inline configs and class
 * constructors are accepted without a cast — `derivePromptSchema(Book, …)`.
 */
interface ModelConfig {
  attributes?: Record<string, AttributeDefinition>
  required?: string[]
  associations?: AssociationConfig
  api?: {
    endpoint?: string
    convention?: BaseConvention
  }
}

interface DeriveFieldOptions {
  overrides?: Record<string, Partial<PromptFieldDefinition>>
  include?: string[] | null
  exclude?: string[]
  promptOnly?: boolean
  apiConvention?: BaseConvention
}

interface DeriveSchemaOptions extends DeriveFieldOptions {
  fieldOverrides?: Record<string, Partial<PromptFieldDefinition>>
  promptFields?: Record<string, PromptFieldDefinition>
  fieldGroups?: Record<string, FieldGroup>
  excludeFields?: string[]
}

interface DerivedSchema {
  fieldDefinitions: Record<string, PromptFieldDefinition>
  fieldGroups: Record<string, FieldGroup>
}

interface CacheStats {
  fieldDefinitions: number
  schemas: number
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/**
 * Cache for memoized results.
 * Since all inputs are static (model classes and prompt class definitions),
 * we can safely cache derivation results indefinitely.
 */
const fieldDefinitionsCache = new Map<string, Record<string, PromptFieldDefinition>>()
const promptSchemaCache = new Map<string, DerivedSchema>()

/**
 * Generate a stable cache key from inputs.
 * Uses JSON stringify to create a deterministic key from all inputs.
 */
function generateCacheKey(modelConfig: ModelConfig, options: DeriveSchemaOptions = {}): string {
  const modelKey = JSON.stringify({
    endpoint: modelConfig?.api?.endpoint,
    attributes: modelConfig?.attributes ? Object.keys(modelConfig.attributes).sort() : [],
    required: modelConfig?.required,
    associations: modelConfig?.associations ? Object.keys(modelConfig.associations).sort() : [],
    apiConvention: options.apiConvention?.name || modelConfig?.api?.convention?.name
  })

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Clear all schema caches */
export function clearSchemaCaches(): CacheStats {
  const stats: CacheStats = {
    fieldDefinitions: fieldDefinitionsCache.size,
    schemas: promptSchemaCache.size
  }

  fieldDefinitionsCache.clear()
  promptSchemaCache.clear()

  return stats
}

/** Get cache statistics */
export function getSchemaCacheStats(): CacheStats {
  return {
    fieldDefinitions: fieldDefinitionsCache.size,
    schemas: promptSchemaCache.size
  }
}

/**
 * Derive field definitions from model configuration (memoized).
 *
 * @param modelConfig - Model configuration object
 * @param options - Derivation options
 * @param options.overrides - Field-specific overrides
 * @param options.include - Only include these fields (if specified)
 * @param options.exclude - Exclude these fields
 * @param options.promptOnly - Only include fields marked as prompt_visible (default: true)
 */
export function deriveFieldDefinitions(
  modelConfig: ModelConfig,
  options: DeriveFieldOptions = {}
): Record<string, PromptFieldDefinition> {
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

  const fieldDefinitions: Record<string, PromptFieldDefinition> = {}
  const attributes = Object.keys(modelConfig.attributes || {})
  const required = modelConfig.required || []

  // Process each attribute
  for (const attrName of attributes) {
    // Skip excluded fields
    if (exclude!.includes(attrName)) {
      continue
    }

    // If include list specified, only process those
    if (include && !include.includes(attrName)) {
      continue
    }

    // Get attribute configuration
    const attrConfig: Partial<AttributeDefinition> = (modelConfig.attributes || {})[attrName] ?? {}

    // Skip if promptOnly=true and field is marked as not visible
    if (promptOnly && attrConfig.prompt_visible === false) {
      continue
    }

    // Build field definition
    const fieldDef: PromptFieldDefinition = {
      type: getKind(attrConfig.type || 'string', attrConfig.format).promptType,
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
      fieldDef.validation = attrConfig.validation as PromptFieldDefinition['validation']
    }

    if (attrConfig.enumValues) {
      fieldDef.enumValues = attrConfig.enumValues
    }

    if (attrConfig.enumDescriptions) {
      fieldDef.enumDescriptions = attrConfig.enumDescriptions as Record<string, string>
    }

    if (attrConfig.format) {
      fieldDef.format = attrConfig.format
    }

    // Add autocomplete configuration
    if (attrConfig.completion) {
      fieldDef.completion = attrConfig.completion
    }

    // Apply field-specific overrides
    if (overrides![attrName]) {
      Object.assign(fieldDef, overrides![attrName])
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
      overrides: overrides!,
      exclude: exclude!,
      apiConvention
    })
  }

  // Cache and return
  fieldDefinitionsCache.set(cacheKey, fieldDefinitions)
  return fieldDefinitions
}

/**
 * Add relation fields from model associations.
 */
function addAssociationFields(
  fieldDefinitions: Record<string, PromptFieldDefinition>,
  associations: AssociationConfig,
  options: {
    overrides: Record<string, Partial<PromptFieldDefinition>>
    exclude: string[]
    apiConvention: BaseConvention
  }
): void {
  const { overrides = {}, exclude = [], apiConvention } = options

  // Process belongsTo relations
  if (associations.belongsTo) {
    for (const [relName, relConfig] of Object.entries(associations.belongsTo)) {
      const resolvedFields = apiConvention.resolveAssociationFields(
        relName,
        relConfig,
        overrides as Record<string, Partial<FieldDefinition>>
      ) as Record<string, FieldDefinition>

      for (const [fieldName, fieldDef] of Object.entries(resolvedFields)) {
        // Skip excluded fields and fields already defined from attributes
        if (!exclude.includes(fieldName) && !fieldDefinitions[fieldName]) {
          fieldDefinitions[fieldName] = fieldDef as unknown as PromptFieldDefinition
        }
      }
    }
  }
}

/**
 * Create a complete prompt schema from model configuration (memoized).
 *
 * @param modelConfig - Model configuration object
 * @param options - Schema options
 * @param options.fieldOverrides - Enhancements to existing model fields
 * @param options.promptFields - Prompt-only fields not in the model
 * @param options.fieldGroups - Field groups for semantic organization
 * @param options.excludeFields - Fields to exclude from derivation
 * @param options.promptOnly - Only include prompt-visible fields (default: true)
 */
export function derivePromptSchema(
  modelConfig: ModelConfig,
  options: DeriveSchemaOptions = {}
): DerivedSchema {
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
  const fieldDefinitions: Record<string, PromptFieldDefinition> = {
    ...derivedFields,
    ...promptFields
  }

  const result: DerivedSchema = {
    fieldDefinitions,
    fieldGroups
  }

  // Cache and return
  promptSchemaCache.set(cacheKey, result)
  return result
}

/**
 * Enhance model config with prompt metadata.
 * Helper to add prompt-specific metadata to existing model configuration.
 */
export function enhanceModelConfig(
  modelConfig: ModelConfig,
  promptMetadata: Record<string, Partial<AttributeDefinition>>
): ModelConfig {
  const enhanced = { ...modelConfig }

  enhanced.attributes = { ...enhanced.attributes }

  // Merge prompt metadata into attributes
  for (const [field, metadata] of Object.entries(promptMetadata)) {
    enhanced.attributes![field] = {
      ...(enhanced.attributes![field] || {}),
      ...metadata
    } as AttributeDefinition
  }

  return enhanced
}
