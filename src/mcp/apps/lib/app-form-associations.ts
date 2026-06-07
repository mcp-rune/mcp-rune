/**
 * app-form association resolution
 *
 * Resolves which associations declared on a form class have been provided via prefill,
 * and builds LLM-actionable instructions for the ones that haven't.
 * See app-form-entities.ts for the full lifecycle with annotated code examples.
 *
 * Field name resolution (which prefill key counts as "resolved") is fully delegated
 * to the API convention — no _link/_id/_ids patterns appear here.
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

import type {
  AppFormAssociation,
  AppFormAssociationInstruction,
  AppFormAssociationResolution,
  AppFormPicker
} from './app-form-entities.js'
import type { AppModelClass } from './app-shared-entities.js'

interface NormalizedEntry {
  name: string
  dependsOn: string | null
  targetModel: string | null
  required: boolean | null
  picker: AppFormPicker | null
}

/** Normalize an association entry to a consistent shape. */
function normalizeEntry(entry: string | Record<string, unknown>): NormalizedEntry {
  if (typeof entry === 'string') {
    return { name: entry, dependsOn: null, targetModel: null, required: null, picker: null }
  }
  return {
    name: entry.name as string,
    dependsOn: (entry.dependsOn as string) || null,
    targetModel: (entry.targetModel as string) || null,
    required: (entry.required as boolean) ?? null,
    picker: (entry.picker as AppFormPicker) || null
  }
}

/** Check which form associations are resolved based on prefill values. */
export function resolveFormAssociations(
  associations: Array<string | Record<string, unknown>>,
  ModelClass: AppModelClass,
  prefill: Record<string, unknown> = {}
): AppFormAssociationResolution {
  const convention = ModelClass.api?.convention as BaseConvention | undefined
  const belongsTo = ModelClass.associations?.belongsTo || {}
  const hasMany = ModelClass.associations?.hasMany || {}
  const resolved: AppFormAssociation[] = []
  const unresolved: AppFormAssociation[] = []

  for (const rawEntry of associations) {
    const normalized = normalizeEntry(rawEntry)
    const { name, dependsOn, picker } = normalized
    const assocConfig = belongsTo[name] || hasMany[name]
    const many = !!hasMany[name]

    // Resolve targetModel and required:
    // 1. Model's belongsTo or hasMany (source of truth for model associations)
    // 2. Inline config on the form entry (for navigation associations not in model)
    const targetModel = assocConfig?.target_model || normalized.targetModel
    if (!targetModel) continue

    const required = normalized.required !== null ? normalized.required : !!assocConfig?.required

    const entry: AppFormAssociation = {
      association: name,
      required,
      targetModel,
      ...(many && { many }),
      ...(dependsOn && { dependsOn }),
      ...(picker && { picker })
    }

    const relConfig = { ...assocConfig, many }
    if (isAssociationResolved(name, convention, prefill, relConfig)) {
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
