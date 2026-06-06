/**
 * Form Association Resolution
 *
 * Resolves which associations declared on a Form class have been provided
 * via prefill. Used by model-form to gate the scalar form until required
 * associations are satisfied.
 *
 * Associations support three formats:
 *   'title'                                    -- simple, looked up in belongsTo
 *   { name: 'asset', dependsOn: 'title' }     -- dependent, looked up in belongsTo
 *   { name: 'title', targetModel: 'title',    -- navigation (not in belongsTo)
 *     required: true, picker: 'autocomplete' }
 *
 * hasMany associations are also supported -- looked up in ModelClass.associations.hasMany.
 * Use the plural key from the model (e.g., 'books' matches hasMany.books).
 *
 * Field name resolution is always delegated to the API convention -- no
 * convention-specific patterns (e.g., _link, _id, _ids) appear here.
 *
 * The `required` flag defaults from the model's association config (single source
 * of truth) but can be overridden inline for navigation associations.
 *
 * The `picker` property specifies which UI to use:
 *   'autocomplete' -- search/type-ahead (large catalogs)
 *   'list'         -- browse all scoped records (small sets)
 */

import type { BaseConvention } from '#src/mcp/data-layer/api-conventions/base-convention.js'

import type { AppModelClass } from './types.js'

interface NormalizedEntry {
  name: string
  dependsOn: string | null
  targetModel: string | null
  required: boolean | null
  picker: string | null
}

interface ResolvedAssociation {
  association: string
  required: boolean
  targetModel: string
  many?: boolean
  dependsOn?: string
  picker?: string
}

export interface AssociationInstruction {
  association: string
  targetModel: string
  required: boolean
  many?: boolean
  message: string
  picker?: string
  dependsOn?: string
}

export interface ResolveResult {
  resolved: ResolvedAssociation[]
  unresolved: ResolvedAssociation[]
  hasUnresolvedRequired: boolean
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
    picker: (entry.picker as string) || null
  }
}

/** Check which form associations are resolved based on prefill values. */
export function resolveFormAssociations(
  associations: Array<string | Record<string, unknown>>,
  ModelClass: AppModelClass,
  prefill: Record<string, unknown> = {}
): ResolveResult {
  const convention = ModelClass.api?.convention as BaseConvention | undefined
  const belongsTo = ModelClass.associations?.belongsTo || {}
  const hasMany = ModelClass.associations?.hasMany || {}
  const resolved: ResolvedAssociation[] = []
  const unresolved: ResolvedAssociation[] = []

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

    const entry: ResolvedAssociation = {
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
  unresolved: ResolvedAssociation[]
): AssociationInstruction[] {
  return unresolved.map((entry) => {
    const label = entry.association.replace(/_/g, ' ')
    const instruction: AssociationInstruction = {
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
