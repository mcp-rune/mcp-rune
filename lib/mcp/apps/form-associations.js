/**
 * Form Association Resolution
 *
 * Resolves which associations declared on a Form class have been provided
 * via prefill. Used by model-form to gate the scalar form until required
 * associations are satisfied.
 *
 * Associations support three formats:
 *   'title'                                    — simple, looked up in belongsTo
 *   { name: 'asset', dependsOn: 'title' }     — dependent, looked up in belongsTo
 *   { name: 'title', targetModel: 'title',    — navigation (not in belongsTo)
 *     required: true, picker: 'autocomplete' }
 *
 * hasMany associations are also supported — looked up in ModelClass.associations.hasMany.
 * Use the plural key from the model (e.g., 'books' matches hasMany.books).
 *
 * Field name resolution is always delegated to the API convention — no
 * convention-specific patterns (e.g., _link, _id, _ids) appear here.
 *
 * The `required` flag defaults from the model's association config (single source
 * of truth) but can be overridden inline for navigation associations.
 *
 * The `picker` property specifies which UI to use:
 *   'autocomplete' — search/type-ahead (large catalogs)
 *   'list'         — browse all scoped records (small sets)
 */

/**
 * Normalize an association entry to a consistent shape.
 * @param {string|Object} entry
 * @returns {{ name: string, dependsOn: string|null, targetModel: string|null, required: boolean|null, picker: string|null }}
 */
function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    return { name: entry, dependsOn: null, targetModel: null, required: null, picker: null }
  }
  return {
    name: entry.name,
    dependsOn: entry.dependsOn || null,
    targetModel: entry.targetModel || null,
    required: entry.required ?? null,
    picker: entry.picker || null
  }
}

/**
 * Check which form associations are resolved based on prefill values.
 *
 * @param {Array<string|Object>} associations - Association entries from FormClass.associations
 * @param {Object} ModelClass - Model class with associations and api.convention
 * @param {Object} [prefill] - Prefill values provided by the LLM
 * @returns {{ resolved: Object[], unresolved: Object[], hasUnresolvedRequired: boolean }}
 */
export function resolveFormAssociations(associations, ModelClass, prefill = {}) {
  const convention = ModelClass.api?.convention
  const belongsTo = ModelClass.associations?.belongsTo || {}
  const hasMany = ModelClass.associations?.hasMany || {}
  const resolved = []
  const unresolved = []

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

    const entry = {
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
 * to check — no convention-specific patterns here.
 *
 * @param {string} name - Association name
 * @param {Object} convention - API convention instance
 * @param {Object} prefill - Prefill values
 * @param {Object} [relConfig] - Association config (target_model, many, etc.)
 * @returns {boolean}
 */
export function isAssociationResolved(name, convention, prefill, relConfig = {}) {
  if (!convention) {
    return [`${name}_link`, `${name}_id`].some((key) => prefill[key] !== undefined)
  }
  const fields = convention.resolveAssociationFields(name, {
    target_model: relConfig.target_model || name,
    autocomplete: false,
    ...relConfig
  })
  return Object.keys(fields).some((fieldName) => prefill[fieldName] !== undefined)
}

/**
 * Build LLM-actionable instructions for unresolved associations.
 *
 * @param {Object[]} unresolved - Unresolved association entries
 * @returns {Object[]} Instructions for the LLM
 */
export function buildAssociationInstructions(unresolved) {
  return unresolved.map((entry) => {
    const label = entry.association.replace(/_/g, ' ')
    const instruction = {
      association: entry.association,
      targetModel: entry.targetModel,
      required: entry.required
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
