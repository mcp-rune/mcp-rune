/**
 * Validate a FormClass against its model. Each entry in `FormClass.fields`
 * and `fieldsets[*].fields` must name an attribute or an association on the
 * model (associations contribute `<name>_id` for belongsTo, `<name>_ids` for
 * hasMany — and association-link forms also accept `<name>_link`).
 *
 * Pure functions only — returns `Issue[]`; the caller decides how to
 * aggregate and surface them.
 */

import { closestMatch } from '#src/core/suggestions.js'
import { collectValidFieldNames } from '#src/mcp/schema/field-names.js'
import type { Issue, ModelClassLike } from '#src/mcp/schema/types.js'

export interface FormClassLike {
  fields?: string[]
  fieldsets?: Record<string, { fields?: string[] }>
}

export function validateFormClass(
  modelName: string,
  FormClass: FormClassLike,
  ModelClass: ModelClassLike
): Issue[] {
  const issues: Issue[] = []
  const validNames = collectValidFieldNames(ModelClass)
  const declared = new Set(FormClass.fields ?? [])

  for (const fieldName of FormClass.fields ?? []) {
    if (!validNames.has(fieldName)) {
      const suggestion = closestMatch(fieldName, validNames)
      issues.push({
        level: 'error',
        scope: 'form',
        model: modelName,
        attribute: fieldName,
        message: `FormClass.fields references unknown attribute "${fieldName}" on ${modelName}`,
        hint: suggestion
          ? `did you mean "${suggestion}"?`
          : `Known attributes: ${[...validNames].join(', ')}`
      })
    }
  }

  for (const [fsKey, fs] of Object.entries(FormClass.fieldsets ?? {})) {
    for (const fieldName of fs.fields ?? []) {
      if (!declared.has(fieldName)) {
        issues.push({
          level: 'error',
          scope: 'form',
          model: modelName,
          attribute: fieldName,
          message: `fieldsets["${fsKey}"] references "${fieldName}" which is not in FormClass.fields`,
          hint: 'every name in a fieldset must also appear in the top-level fields array'
        })
      }
    }
  }

  return issues
}
