/**
 * bindAppForm — merge an AppFormClass with its AppModelClass once.
 *
 * Every downstream consumer (schema generation, association resolution,
 * iframe rendering) used to look up the same attribute / association
 * metadata from ModelClass independently. This step consolidates that
 * merge into a single BoundAppForm structure: per-field attribute +
 * association info, plus the form-level associations already merged
 * with model belongsTo / hasMany metadata.
 *
 * The field → association map is built by inverting
 * `convention.resolveAssociationFields(...)` calls, so deployments on
 * non-JSON-API conventions (HAL `_link`, nested relations) get correct
 * field-type derivation without the previous `name.endsWith('_id')` /
 * `name.replace(/_ids$/, 's')` heuristics. When no convention is set
 * the fallback mirrors the JSON-API shapes the heuristics implicitly
 * assumed.
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'
import type { BelongsToAssociation, HasManyAssociation } from '#src/mcp/models/model-definitions.js'

import type {
  AppFormAssociation,
  AppFormAssociationEntry,
  AppFormClass,
  AppFormFieldsetConfig,
  AppFormPicker
} from './app-form-entities.js'
import type { AppAttributeDefinition, AppModelClass } from './app-shared-entities.js'

/** Per-field link to a belongsTo or hasMany association on the model. */
export interface BoundAppFormFieldAssociation {
  /** Association key on `ModelClass.associations.{belongsTo,hasMany}`. */
  name: string
  /** Target model name (e.g. `'location'` for `belongsTo.location`). */
  targetModel: string
  /** `true` for hasMany; `false` for belongsTo. */
  many: boolean
}

/** A form field merged with the attribute it renders and any association it covers. */
export interface BoundAppFormField {
  name: string
  attribute: AppAttributeDefinition
  association?: BoundAppFormFieldAssociation
}

/**
 * The result of merging an AppFormClass with its AppModelClass.
 *
 * - `fields` carries each field merged with its attribute and any association.
 * - `associations` carries the form-level association declarations, already
 *   merged with model `belongsTo` / `hasMany` metadata (required, targetModel,
 *   many). Same shape as the pre-A4 `resolveFormAssociations` produced.
 * - `fieldsets` carries the pass-through fieldset config from the form.
 * - `modelClass` is retained so consumers reach `api.endpoint`,
 *   `api.parent`, `singularName`, etc. without re-importing the model.
 */
export interface BoundAppForm {
  modelClass: AppModelClass
  fields: BoundAppFormField[]
  fieldsets?: Record<string, AppFormFieldsetConfig>
  associations: AppFormAssociation[]
}

/** Bind a form class to its model. The returned structure is what every
 * downstream consumer (schema generation, association resolution) reads. */
export function bindAppForm(FormClass: AppFormClass, ModelClass: AppModelClass): BoundAppForm {
  const fieldToAssoc = buildFieldToAssociationMap(ModelClass)
  const attrs = ModelClass.attributes ?? {}

  const fields: BoundAppFormField[] = []
  for (const name of FormClass.fields) {
    const attribute = attrs[name]
    if (!attribute) continue
    if (attribute.prompt_visible === false) continue
    const assoc = fieldToAssoc.get(name)
    fields.push({ name, attribute, ...(assoc && { association: assoc }) })
  }

  const associations = mergeFormAssociationEntries(FormClass.associations ?? [], ModelClass)

  return {
    modelClass: ModelClass,
    fields,
    ...(FormClass.fieldsets && { fieldsets: FormClass.fieldsets }),
    associations
  }
}

/** Build the convention-aware field-name → association map for a model. */
function buildFieldToAssociationMap(
  ModelClass: AppModelClass
): Map<string, BoundAppFormFieldAssociation> {
  const map = new Map<string, BoundAppFormFieldAssociation>()
  const convention = ModelClass.api?.convention as BaseConvention | undefined
  const belongsTo = (ModelClass.associations?.belongsTo ?? {}) as Record<
    string,
    BelongsToAssociation
  >
  const hasMany = (ModelClass.associations?.hasMany ?? {}) as Record<string, HasManyAssociation>

  if (convention) {
    for (const [name, config] of Object.entries(belongsTo)) {
      const fields = convention.resolveAssociationFields(name, {
        ...config,
        autocomplete: false
      })
      for (const fieldName of Object.keys(fields)) {
        map.set(fieldName, { name, targetModel: config.target_model, many: false })
      }
    }
    for (const [name, config] of Object.entries(hasMany)) {
      const fields = convention.resolveAssociationFields(name, {
        ...config,
        autocomplete: false,
        many: true
      })
      for (const fieldName of Object.keys(fields)) {
        map.set(fieldName, { name, targetModel: config.target_model, many: true })
      }
    }
    return map
  }

  // Convention-free fallback mirrors the JSON-API shapes the original
  // generateAppFormSchema hardcoded in buildField.
  for (const [name, config] of Object.entries(belongsTo)) {
    map.set(`${name}_id`, { name, targetModel: config.target_model, many: false })
  }
  for (const [name, config] of Object.entries(hasMany)) {
    const singular = name.endsWith('s') ? name.slice(0, -1) : name
    map.set(`${singular}_ids`, { name, targetModel: config.target_model, many: true })
  }
  return map
}

interface NormalizedEntry {
  name: string
  dependsOn: string | null
  targetModel: string | null
  required: boolean | null
  picker: AppFormPicker | null
}

function normalizeFormEntry(entry: string | AppFormAssociationEntry): NormalizedEntry {
  if (typeof entry === 'string') {
    return { name: entry, dependsOn: null, targetModel: null, required: null, picker: null }
  }
  return {
    name: entry.name,
    dependsOn: entry.dependsOn ?? null,
    targetModel: entry.targetModel ?? null,
    required: entry.required ?? null,
    picker: entry.picker ?? null
  }
}

/**
 * Merge each FormClass.associations entry with model-side metadata.
 * Mirrors the original resolveFormAssociations call but stops before
 * consulting prefill — prefill resolution happens at consumption time.
 */
function mergeFormAssociationEntries(
  entries: Array<string | AppFormAssociationEntry>,
  ModelClass: AppModelClass
): AppFormAssociation[] {
  const belongsTo = ModelClass.associations?.belongsTo ?? {}
  const hasMany = ModelClass.associations?.hasMany ?? {}
  const out: AppFormAssociation[] = []
  for (const rawEntry of entries) {
    const normalized = normalizeFormEntry(rawEntry)
    const { name, dependsOn, picker } = normalized
    const assocConfig = belongsTo[name] || hasMany[name]
    const many = !!hasMany[name]
    const targetModel = assocConfig?.target_model || normalized.targetModel
    if (!targetModel) continue
    const required = normalized.required !== null ? normalized.required : !!assocConfig?.required
    out.push({
      association: name,
      required,
      targetModel,
      ...(many && { many }),
      ...(dependsOn && { dependsOn }),
      ...(picker && { picker })
    })
  }
  return out
}
