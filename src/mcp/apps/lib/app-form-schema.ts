/**
 * App Form Schema Generator
 *
 * Generates an app form schema from `AppFormClass.fields` (+ optional
 * `AppFormClass.fieldsets`) merged with `ModelClass.attributes`. Pure data:
 * no API calls, no side effects. Association fields are marked with an
 * `association` property so the app's handleToolCall can fetch options
 * from the API separately.
 *
 * Boot-time `validateAppForm` guarantees every registered FormClass has at
 * least one renderable field. The runtime throw at the head of this
 * function is belt-and-braces for callers that bypass `validateRegistries`.
 */

import { getKind } from '#src/mcp/models/kinds/index.js'

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
  fields: string[]
  fieldsets?: Record<
    string,
    { title?: string; description?: string; required?: boolean; fields?: string[] }
  >
  [key: string]: unknown
}

/** Generate an app form schema from model and form configuration. */
export function generateAppFormSchema(
  ModelClass: AppModelClass,
  FormClass: AppFormClassLike,
  { allModelClasses }: AppFormSchemaOptions = {}
): AppFormSchema {
  if (!Array.isArray(FormClass?.fields) || FormClass.fields.length === 0) {
    throw new Error(
      `app-form-schema: ${ModelClass.singularName} has no AppFormClass.fields. ` +
        `Call validateRegistries() at server boot to catch this earlier.`
    )
  }

  const groupKey = 'default'

  const fields: AppFormFieldDefinition[] = []
  for (const fieldName of FormClass.fields) {
    const attr = ModelClass.attributes[fieldName]
    if (!attr) continue
    if (attr.prompt_visible === false) continue

    const field = buildField(fieldName, attr, ModelClass, groupKey, allModelClasses)
    if (field) fields.push(field)
  }

  let fieldsets: AppFormFieldsetDefinition[]
  if (FormClass.fieldsets && Object.keys(FormClass.fieldsets).length > 0) {
    const fieldsByName = new Map(fields.map((f) => [f.name, f]))
    for (const [fsKey, fsConfig] of Object.entries(FormClass.fieldsets)) {
      for (const name of fsConfig.fields || []) {
        const field = fieldsByName.get(name)
        if (field) field.group = fsKey
      }
    }

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
    field.type = 'checkbox_group'
    field.options = attr.enumValues.map((v) => ({ value: v, label: humanize(v) }))
  } else if (attr.type === 'array') {
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

  if (attr.validation) {
    field.validation = { ...attr.validation }
  }

  if (attr.description) {
    field.description = attr.description
  }

  if (attr.examples && attr.examples.length > 0) {
    field.placeholder = `e.g. ${attr.examples[0]}`
  }

  if (attr.default !== undefined && !field.default) {
    field.default = attr.default
  }

  if (attr.visibleWhen) {
    field.visibleWhen = { ...attr.visibleWhen }
  }

  return field
}
