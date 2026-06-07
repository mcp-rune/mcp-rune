/**
 * app-form association resolution
 *
 * Splits a bound form's declared associations into resolved vs unresolved
 * based on the current prefill, and builds LLM-actionable instructions
 * for the unresolved bucket. The model↔form merge that used to happen
 * inline here is now performed once by `bindAppForm`; this module
 * focuses solely on prefill-driven resolution.
 *
 * Field name resolution (which prefill key counts as "resolved") is
 * fully delegated to the API convention — no `_link` / `_id` patterns
 * appear here.
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

import type {
  AppFormAssociation,
  AppFormAssociationInstruction,
  AppFormAssociationResolution
} from './app-form-entities.js'
import type { BoundAppForm } from './bind-app-form.js'

/**
 * Split the bound form's associations into resolved vs unresolved based
 * on prefill values.
 */
export function resolveFormAssociations(
  boundForm: BoundAppForm,
  prefill: Record<string, unknown> = {}
): AppFormAssociationResolution {
  const convention = boundForm.modelClass.api?.convention as BaseConvention | undefined
  const belongsTo = boundForm.modelClass.associations?.belongsTo ?? {}
  const hasMany = boundForm.modelClass.associations?.hasMany ?? {}
  const resolved: AppFormAssociation[] = []
  const unresolved: AppFormAssociation[] = []

  for (const entry of boundForm.associations) {
    const assocConfig = belongsTo[entry.association] || hasMany[entry.association]
    const relConfig = { ...assocConfig, many: !!entry.many }
    if (isAssociationResolved(entry.association, convention, prefill, relConfig)) {
      resolved.push(entry)
    } else {
      unresolved.push(entry)
    }
  }

  const hasUnresolvedRequired = unresolved.some((a) => a.required)
  return { resolved, unresolved, hasUnresolvedRequired }
}

/**
 * Check if an association is resolved in the prefill.
 *
 * Delegates entirely to the API convention to determine which field names
 * to check -- no convention-specific patterns here.
 */
export function isAssociationResolved(
  name: string,
  convention: BaseConvention | undefined,
  prefill: Record<string, unknown>,
  relConfig: Record<string, unknown> = {}
): boolean {
  if (!convention) {
    return [`${name}_link`, `${name}_id`].some((key) => prefill[key] !== undefined)
  }
  const fields = convention.resolveAssociationFields(name, {
    target_model: (relConfig.target_model as string) || name,
    autocomplete: false,
    ...relConfig
  })
  return Object.keys(fields).some((fieldName) => prefill[fieldName] !== undefined)
}

/** Build LLM-actionable instructions for unresolved associations. */
export function buildAssociationInstructions(
  unresolved: AppFormAssociation[]
): AppFormAssociationInstruction[] {
  return unresolved.map((entry) => {
    const label = entry.association.replace(/_/g, ' ')
    const instruction: AppFormAssociationInstruction = {
      association: entry.association,
      targetModel: entry.targetModel,
      required: entry.required,
      message: ''
    }
    if (entry.many) {
      instruction.many = true
      instruction.message = entry.required
        ? `Select one or more ${label}`
        : `Optionally select one or more ${label}`
    } else {
      instruction.message = entry.required ? `Select a ${label}` : `Optionally select a ${label}`
    }
    if (entry.picker) instruction.picker = entry.picker
    if (entry.dependsOn) {
      instruction.dependsOn = entry.dependsOn
      instruction.message += ` (scoped to the selected ${entry.dependsOn.replace(/_/g, ' ')})`
    }
    return instruction
  })
}
