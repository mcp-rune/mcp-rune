/**
 * App Form Schema Generator
 *
 * Generates an app form schema from a `BoundAppForm` — the merged view
 * of an `AppFormClass` and its `AppModelClass` produced by
 * `bindAppForm`. Field-name → association mapping (belongsTo / hasMany)
 * is already resolved on each bound field, so this module never has to
 * guess from `_id` / `_ids` suffixes; the convention drove that
 * decision during binding.
 *
 * Pure data: no API calls, no side effects. Association fields are
 * marked with an `association` property so the app's handleToolCall can
 * fetch options from the API separately.
 *
 * Boot-time `validateAppForm` guarantees every registered FormClass has
 * at least one renderable field. The runtime throw at the head of this
 * function is belt-and-braces for callers that bypass
 * `validateRegistries`.
 */

import { getKind } from '#src/mcp/models/kinds/index.js'

import type {
  AppFormFieldDefinition,
  AppFormFieldsetDefinition,
  AppFormSchema,
  AppModelClass
} from './app-shared-entities.js'
import type { BoundAppForm, BoundAppFormField } from './bind-app-form.js'
import { humanize, pluralize } from './helpers.js'

export interface AppFormSchemaOptions {
  /** Other model classes — used to detect nested associations. */
  allModelClasses?: Record<string, AppModelClass>
}

/** Generate an app form schema from a bound form. */
export function generateAppFormSchema(
  boundForm: BoundAppForm,
  { allModelClasses }: AppFormSchemaOptions = {}
): AppFormSchema {
  if (boundForm.fields.length === 0) {
    throw new Error(
      `app-form-schema: ${boundForm.modelClass.singularName} bound form has no renderable fields. ` +
        `Call validateRegistries() at server boot to catch this earlier.`
    )
  }

  const groupKey = 'default'
  const ModelClass = boundForm.modelClass

  const fields: AppFormFieldDefinition[] = []
  for (const boundField of boundForm.fields) {
    fields.push(buildField(boundField, ModelClass, groupKey, allModelClasses))
  }

  let fieldsets: AppFormFieldsetDefinition[]
  if (boundForm.fieldsets && Object.keys(boundForm.fieldsets).length > 0) {
    const fieldsByName = new Map(fields.map((f) => [f.name, f]))
    for (const [fsKey, fsConfig] of Object.entries(boundForm.fieldsets)) {
      for (const name of fsConfig.fields || []) {
        const field = fieldsByName.get(name)
        if (field) field.group = fsKey
      }
    }

    const fieldsByGroup: Record<string, AppFormFieldDefinition[]> = {}
    for (const f of fields) {
      ;(fieldsByGroup[f.group] = fieldsByGroup[f.group] || []).push(f)
    }

    fieldsets = Object.entries(boundForm.fieldsets)
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

/** Build a single field definition from a bound field. */
function buildField(
  boundField: BoundAppFormField,
  ModelClass: AppModelClass,
  groupKey: string,
  allModelClasses?: Record<string, AppModelClass>
): AppFormFieldDefinition {
  const { name, attribute: attr, association } = boundField
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
  if (association) {
    field.type = association.many ? 'multiselect' : 'select'
    field.association = {
      endpoint: pluralize(association.targetModel),
      labelField: 'name'
    }

    // Detect nested associations (e.g., categories nested under themes).
    // Only applies to single-value belongsTo selectors — hasMany
    // multiselects don't currently route through a parent endpoint.
    if (!association.many) {
      const targetModel = allModelClasses?.[association.targetModel]
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
          field.association.endpoint = parentModelClass.api.endpoint
        }
      }
    }
  } else if (attr.type === 'array' && attr.enumValues) {
    field.type = 'checkbox_group'
    field.options = attr.enumValues.map((v) => ({ value: v, label: humanize(v) }))
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
