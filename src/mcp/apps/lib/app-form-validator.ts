/**
 * Validate an AppForm class against its model. Each entry in `AppFormClass.fields`
 * and `fieldsets[*].fields` must name an attribute or an association on the
 * model (associations contribute `<name>_id` for belongsTo, `<name>_ids` for
 * hasMany — and association-link forms also accept `<name>_link`).
 *
 * Pure functions only — returns `Issue[]`; the caller decides how to
 * aggregate and surface them.
 */

import { closestMatch } from '#src/core/suggestions.js'
import { collectValidFieldNames } from '#src/mcp/model-layer/field-names.js'
import type { Issue, ModelClassLike } from '#src/mcp/schema/types.js'

export interface AppFormClassLike {
  fields?: string[]
  fieldsets?: Record<string, { fields?: string[] }>
}

export function validateAppForm(
  modelName: string,
  FormClass: AppFormClassLike,
  ModelClass: ModelClassLike
): Issue[] {
  const issues: Issue[] = []
  const fields = FormClass.fields ?? []

  if (fields.length === 0) {
    issues.push({
      level: 'error',
      scope: 'form',
      model: modelName,
      message: `AppFormClass for "${modelName}" has no fields — define a non-empty static fields array`,
      hint: 'a form with zero fields cannot render; remove the form class or list at least one renderable attribute'
    })
    return issues
  }

  const validNames = collectValidFieldNames(ModelClass)
  const declared = new Set(fields)
  const attrs = ModelClass.attributes ?? {}
  let validCount = 0
  let renderableCount = 0

  for (const fieldName of fields) {
    if (!validNames.has(fieldName)) {
      const suggestion = closestMatch(fieldName, validNames)
      issues.push({
        level: 'error',
        scope: 'form',
        model: modelName,
        attribute: fieldName,
        message: `AppFormClass.fields references unknown attribute "${fieldName}" on ${modelName}`,
        hint: suggestion
          ? `did you mean "${suggestion}"?`
          : `Known attributes: ${[...validNames].join(', ')}`
      })
      continue
    }
    validCount++
    if (attrs[fieldName]?.prompt_visible !== false) renderableCount++
  }

  if (validCount > 0 && renderableCount === 0) {
    issues.push({
      level: 'error',
      scope: 'form',
      model: modelName,
      message: `AppFormClass for "${modelName}" has no renderable fields — every entry in fields is prompt_visible: false`,
      hint: 'list at least one attribute whose definition does not set prompt_visible: false'
    })
  }

  for (const [fsKey, fs] of Object.entries(FormClass.fieldsets ?? {})) {
    for (const fieldName of fs.fields ?? []) {
      if (!declared.has(fieldName)) {
        issues.push({
          level: 'error',
          scope: 'form',
          model: modelName,
          attribute: fieldName,
          message: `fieldsets["${fsKey}"] references "${fieldName}" which is not in AppFormClass.fields`,
          hint: 'every name in a fieldset must also appear in the top-level fields array'
        })
      }
    }
  }

  return issues
}
