/**
 * Form Schema Generator
 *
 * Generates form schemas from model configuration. Supports two modes:
 *
 * 1. **FormClass mode** (preferred): Reads `FormClass.fields` for field list
 *    and optional `FormClass.fieldsets` for layout. No Prompt dependency needed.
 *
 * 2. **Prompt mode** (legacy): Reads `PromptClass.fieldGroups/sections` for field
 *    list and layout, with `associationTransformers` for association handling.
 *
 * The schema is a pure data structure -- no API calls, no side effects.
 * Association fields are marked with an `association` property so the
 * app's handleToolCall can fetch options from the API separately.
 */

import type {
  TransformerConfig,
  TransformerEntry
} from '#src/mcp/prompts/association-transformers.js'
import { buildFieldTransformerMap } from '#src/mcp/prompts/association-transformers.js'
import type { FieldGroup, Section } from '#src/mcp/prompts/base-prompt.js'

import { humanize, pluralize } from './helpers.js'
import type {
  AppAttributeDefinition,
  AppModelClass,
  FieldsetDefinition,
  FormFieldDefinition,
  FormSchema
} from './types.js'

/** Map model attribute types to HTML form field types */
const TYPE_MAP: Record<string, string> = {
  string: 'text',
  text: 'textarea',
  integer: 'number',
  number: 'number',
  boolean: 'checkbox',
  date: 'date'
}

interface FormSchemaOptions {
  allModelClasses?: Record<string, AppModelClass>
}

interface FormClassLike {
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
 * Generate a form schema from model and optional form/prompt configuration.
 *
 * Priority: FormClass > PromptClass > empty schema.
 */
export function generateFormSchema(
  ModelClass: AppModelClass,
  FormOrPromptClass?: FormClassLike | PromptClassLike,
  { allModelClasses }: FormSchemaOptions = {}
): FormSchema {
  // FormClass path: has static fields array
  if (
    Array.isArray((FormOrPromptClass as FormClassLike)?.fields) &&
    (FormOrPromptClass as FormClassLike).fields!.length > 0
  ) {
    return generateFromFormClass(ModelClass, FormOrPromptClass as FormClassLike, {
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

// --- FormClass-based generation ---

function generateFromFormClass(
  ModelClass: AppModelClass,
  FormClass: FormClassLike,
  { allModelClasses }: FormSchemaOptions = {}
): FormSchema {
  const groupKey = 'default'

  const fields: FormFieldDefinition[] = []
  for (const fieldName of FormClass.fields!) {
    const attr = ModelClass.attributes[fieldName]
    if (!attr) continue
    if (attr.prompt_visible === false) continue

    const field = buildField(fieldName, attr, ModelClass, groupKey, allModelClasses)
    if (field) fields.push(field)
  }

  // Use FormClass.fieldsets if provided, otherwise create a single default fieldset
  let fieldsets: FieldsetDefinition[]
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
    const fieldsByGroup: Record<string, FormFieldDefinition[]> = {}
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
  { allModelClasses }: FormSchemaOptions = {}
): FormSchema {
  const fields: FormFieldDefinition[] = []
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
  const fieldsByGroup: Record<string, FormFieldDefinition[]> = {}
  for (const f of fields) {
    ;(fieldsByGroup[f.group] = fieldsByGroup[f.group] || []).push(f)
  }

  // Build fieldsets from sections, filtering out those with zero rendered fields
  const fieldsets: FieldsetDefinition[] = Object.entries(sections)
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
): FormFieldDefinition {
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
): FormFieldDefinition {
  const field: FormFieldDefinition = {
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
  } else if (attr.type === 'enum' || (attr.enumValues && attr.type !== 'array')) {
    field.type = 'select'
    field.options = attr.enumValues!.map((v) => ({ value: v, label: humanize(v) }))
    if (attr.default !== undefined) field.default = attr.default
  } else if (attr.format === 'URL') {
    field.type = 'url'
  } else if (attr.format === 'base64') {
    field.type = 'file'
  } else {
    field.type = TYPE_MAP[attr.type!] || 'text'
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
