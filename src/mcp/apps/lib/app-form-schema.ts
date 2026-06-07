/**
 * App Form Schema Generator
 *
 * Generates app form schemas from model configuration. Supports two modes:
 *
 * 1. **AppFormClass mode** (preferred): Reads `AppFormClass.fields` for field list
 *    and optional `AppFormClass.fieldsets` for layout. No Prompt dependency needed.
 *
 * 2. **Prompt mode** (legacy): Reads `PromptClass.fieldGroups/sections` for field
 *    list and layout, with `associationTransformers` for association handling.
 *
 * The schema is a pure data structure -- no API calls, no side effects.
 * Association fields are marked with an `association` property so the
 * app's handleToolCall can fetch options from the API separately.
 */

import { getKind } from '#src/mcp/models/kinds/index.js'
import type {
  TransformerConfig,
  TransformerEntry
} from '#src/mcp/prompts/association-transformers.js'
import { buildFieldTransformerMap } from '#src/mcp/prompts/association-transformers.js'
import type { FieldGroup, Section } from '#src/mcp/prompts/prompt-definitions.js'

import type {
  AppAttributeDefinition,
  AppFormFieldDefinition,
  AppFormFieldsetDefinition,
  AppFormSchema,
  AppModelClass
} from './app-shared-entities.js'
import { humanize, pluralize } from './helpers.js'

interface AppFormSchemaOptions {
  allModelClasses?: Record<string, AppModelClass>
}

interface AppFormClassLike {
  fields?: string[]
  fieldsets?: Record<
    string,
    { title?: string; description?: string; required?: boolean; fields?: string[] }
  >
  [key: string]: unknown
}

interface PromptClassLike {
  fieldGroups?: Record<string, FieldGroup>
  sections?: Record<string, Section>
  associationTransformers?: Record<string, TransformerConfig>
  title?: string
  [key: string]: unknown
}

/**
 * Generate an app form schema from model and optional form/prompt configuration.
 *
 * Priority: AppFormClass > PromptClass > empty schema.
 */
export function generateAppFormSchema(
  ModelClass: AppModelClass,
  FormOrPromptClass?: AppFormClassLike | PromptClassLike,
  { allModelClasses }: AppFormSchemaOptions = {}
): AppFormSchema {
  // AppFormClass path: has static fields array
  if (
    Array.isArray((FormOrPromptClass as AppFormClassLike)?.fields) &&
    (FormOrPromptClass as AppFormClassLike).fields!.length > 0
  ) {
    return generateFromFormClass(ModelClass, FormOrPromptClass as AppFormClassLike, {
      allModelClasses
    })
  }

  // PromptClass path (legacy): has fieldGroups
  const asPrompt = FormOrPromptClass as PromptClassLike | undefined
  const hasPromptLayout = asPrompt?.fieldGroups && Object.keys(asPrompt.fieldGroups).length > 0
  if (hasPromptLayout) {
    return generateFromPrompt(ModelClass, asPrompt!, { allModelClasses })
  }

  // Fallback: empty schema
  return {
    model: ModelClass.singularName,
    title: `Create ${humanize(ModelClass.api.endpoint)}`,
    fieldsets: [],
    fields: []
  }
}

// --- AppFormClass-based generation ---

function generateFromFormClass(
  ModelClass: AppModelClass,
  FormClass: AppFormClassLike,
  { allModelClasses }: AppFormSchemaOptions = {}
): AppFormSchema {
  const groupKey = 'default'

  const fields: AppFormFieldDefinition[] = []
  for (const fieldName of FormClass.fields!) {
    const attr = ModelClass.attributes[fieldName]
    if (!attr) continue
    if (attr.prompt_visible === false) continue

    const field = buildField(fieldName, attr, ModelClass, groupKey, allModelClasses)
    if (field) fields.push(field)
  }

  // Use FormClass.fieldsets if provided, otherwise create a single default fieldset
  let fieldsets: AppFormFieldsetDefinition[]
  if (FormClass.fieldsets && Object.keys(FormClass.fieldsets).length > 0) {
    // Assign fields to their declared fieldset groups
    const fieldsByName = new Map(fields.map((f) => [f.name, f]))
    for (const [fsKey, fsConfig] of Object.entries(FormClass.fieldsets)) {
      for (const name of fsConfig.fields || []) {
        const field = fieldsByName.get(name)
        if (field) field.group = fsKey
      }
    }

    // Index rendered fields by group for empty-fieldset filtering
    const fieldsByGroup: Record<string, AppFormFieldDefinition[]> = {}
    for (const f of fields) {
      ;(fieldsByGroup[f.group] = fieldsByGroup[f.group] || []).push(f)
    }

    fieldsets = Object.entries(FormClass.fieldsets)
      .map(([key, fs]) => ({
        key,
        title: fs.title || humanize(key),
        description: fs.description || '',
        required: fs.required || false,
        groups: [key]
      }))
      .filter((fs) => fs.groups.some((g) => (fieldsByGroup[g] || []).length > 0))
  } else {
    fieldsets = [
      {
        key: groupKey,
        title: `${humanize(ModelClass.singularName)} Details`,
        description: '',
        required: false,
        groups: [groupKey]
      }
    ]
  }

  return {
    model: ModelClass.singularName,
    title: `Create ${humanize(ModelClass.api.endpoint)}`,
    fieldsets,
    fields
  }
}

// --- Prompt-based generation (legacy) ---

function generateFromPrompt(
  ModelClass: AppModelClass,
  PromptClass: PromptClassLike,
  { allModelClasses }: AppFormSchemaOptions = {}
): AppFormSchema {
  const fields: AppFormFieldDefinition[] = []
  const fieldGroups = PromptClass.fieldGroups || {}
  const sections = PromptClass.sections || {}
  const transformers = PromptClass.associationTransformers || {}

  // Map each target field name -> its transformer config
  const fieldToTransformer = buildFieldTransformerMap(transformers)

  // Build ordered field list from fieldGroups
  for (const [groupKey, group] of Object.entries(fieldGroups)) {
    for (const fieldName of group.fields) {
      const transformer = fieldToTransformer.get(fieldName)

      if (transformer) {
        if (transformer.type === 'select') {
          // Simple association -> render as <select>
          fields.push(buildSelectFromTransformer(fieldName, transformer, groupKey))
        }
        // type: 'autocomplete' or 'multi_select' -> SKIP (LLM pre-orchestrates)
        continue
      }

      // Not a transformer target -> check model attributes (existing behavior)
      const attr = ModelClass.attributes[fieldName]
      if (!attr) continue
      if (attr.prompt_visible === false) continue

      const field = buildField(fieldName, attr, ModelClass, groupKey, allModelClasses)
      if (field) fields.push(field)
    }
  }

  // Index rendered fields by group for empty-fieldset filtering
  const fieldsByGroup: Record<string, AppFormFieldDefinition[]> = {}
  for (const f of fields) {
    ;(fieldsByGroup[f.group] = fieldsByGroup[f.group] || []).push(f)
  }

  // Build fieldsets from sections, filtering out those with zero rendered fields
  const fieldsets: AppFormFieldsetDefinition[] = Object.entries(sections)
    .map(([key, section]) => ({
      key,
      title: section.title,
      description: section.description,
      required: section.required || false,
      groups: section.groups || [key]
    }))
    .filter((fs) => fs.groups.some((g) => (fieldsByGroup[g] || []).length > 0))

  const groupLayouts = buildGroupLayouts(fieldGroups)

  return {
    model: ModelClass.singularName,
    title: PromptClass.title || `Create ${humanize(ModelClass.api.endpoint)}`,
    fieldsets,
    fields,
    ...(groupLayouts && { groupLayouts })
  }
}

// --- Shared helpers ---

/**
 * Build group layout overrides from fieldGroups configuration.
 * Only includes groups that have an explicit layout property.
 */
function buildGroupLayouts(
  fieldGroups: Record<string, FieldGroup>
): Record<string, unknown> | undefined {
  const layouts: Record<string, unknown> = {}
  for (const [key, group] of Object.entries(fieldGroups)) {
    const g = group as unknown as Record<string, unknown>
    if (g.layout) {
      layouts[key] = g.layout
    }
  }
  return Object.keys(layouts).length > 0 ? layouts : undefined
}

/**
 * Build a select field definition from a transformer config.
 * Used for `type: 'select'` association transformers.
 */
function buildSelectFromTransformer(
  name: string,
  transformer: TransformerEntry,
  groupKey: string
): AppFormFieldDefinition {
  return {
    name,
    label: humanize(name.replace(/_link$/, '')),
    group: groupKey,
    required: false,
    type: 'select',
    association: {
      endpoint: pluralize(transformer.source.model!),
      labelField: ((transformer as Record<string, unknown>).labelField as string) || 'name',
      valueField: transformer.valueField || 'id'
    }
  }
}

/** Build a single field definition from model attribute config */
function buildField(
  name: string,
  attr: AppAttributeDefinition,
  ModelClass: AppModelClass,
  groupKey: string,
  allModelClasses?: Record<string, AppModelClass>
): AppFormFieldDefinition {
  const field: AppFormFieldDefinition = {
    name,
    label: attr.label || humanize(name),
    group: groupKey,
    required: !!attr.required,
    type: 'text',
    ...(attr.type && { kind: attr.type }),
    ...(attr.format && { format: attr.format })
  }

  // Determine field type -- order matters: associations override base types
  if (name.endsWith('_id')) {
    const assocName = name.replace(/_id$/, '')
    const assoc = ModelClass.associations?.belongsTo?.[assocName]
    if (assoc) {
      field.type = 'select'
      field.association = { endpoint: pluralize(assoc.target_model), labelField: 'name' }

      // Detect nested associations (e.g., categories nested under themes)
      const targetModel = allModelClasses?.[assoc.target_model]
      if (targetModel?.api?.standalone === false && targetModel.api?.parent) {
        const parentNames = Array.isArray(targetModel.api.parent)
          ? targetModel.api.parent
          : [targetModel.api.parent]
        const parentName = parentNames[0]!
        const parentModelClass = allModelClasses?.[parentName]
        if (parentModelClass) {
          field.association.nested = {
            parentModel: parentName,
            childEndpoint: targetModel.api.endpoint
          }
          // Override endpoint to be the parent's endpoint (used for path construction)
          field.association.endpoint = parentModelClass.api.endpoint
        }
      }
    } else {
      field.type = 'number'
    }
  } else if (attr.type === 'array' && attr.enumValues) {
    // Array with fixed options (e.g., formats: ['physical', 'ebook', 'pdf'])
    field.type = 'checkbox_group'
    field.options = attr.enumValues.map((v) => ({ value: v, label: humanize(v) }))
  } else if (attr.type === 'array') {
    // Array without enumValues -- likely an association (e.g., tag_ids)
    field.type = 'multiselect'
    const assocName = name.replace(/_ids$/, 's')
    const assoc = ModelClass.associations?.hasMany?.[assocName]
    if (assoc) {
      field.association = { endpoint: pluralize(assoc.target_model), labelField: 'name' }
    }
  } else if (attr.type === 'enum' || attr.enumValues) {
    if (!Array.isArray(attr.enumValues) || attr.enumValues.length === 0) {
      // Belt-and-braces: validateRegistries() should have caught this at
      // boot. Anything reaching here bypassed the boot validator (custom
      // app, test with hand-built schema). Fail loudly with the model and
      // attribute name so the source is obvious.
      throw new Error(
        `app-form-schema: ${ModelClass.singularName}.${name} has type "enum" but no enumValues. ` +
          `Call validateRegistries() at server boot to catch this earlier.`
      )
    }
    field.type = 'select'
    field.options = attr.enumValues.map((v) => ({ value: v, label: humanize(v) }))
    if (attr.default !== undefined) field.default = attr.default
  } else {
    field.type = getKind(attr.type, attr.format).htmlInputType
  }

  // Validation constraints
  if (attr.validation) {
    field.validation = { ...attr.validation }
  }

  // Description as help text
  if (attr.description) {
    field.description = attr.description
  }

  // Placeholder from first example
  if (attr.examples && attr.examples.length > 0) {
    field.placeholder = `e.g. ${attr.examples[0]}`
  }

  // Default value (for non-enum types that have defaults)
  if (attr.default !== undefined && !field.default) {
    field.default = attr.default
  }

  // Conditional visibility
  if (attr.visibleWhen) {
    field.visibleWhen = { ...attr.visibleWhen }
  }

  return field
}
