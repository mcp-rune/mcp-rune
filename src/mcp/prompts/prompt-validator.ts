/**
 * Validate a PromptClass: every fieldGroups[*].fields entry must resolve to
 * an attribute on the model, and every sections[*].groups entry must name a
 * fieldGroup key.
 *
 * Pure functions only — returns `Issue[]`; the caller decides how to
 * aggregate and surface them.
 */

import { closestMatch } from '#src/core/suggestions.js'
import { collectValidFieldNames } from '#src/mcp/model-layer/field-names.js'
import type { Issue, ModelClassLike } from '#src/mcp/schema/types.js'

export interface PromptClassLike {
  fieldGroups?: Record<string, { fields: string[] }>
  sections?: Record<string, { groups?: string[] }>
}

export function validatePromptClass(
  modelName: string,
  PromptClass: PromptClassLike,
  ModelClass: ModelClassLike
): Issue[] {
  const issues: Issue[] = []
  const validNames = collectValidFieldNames(ModelClass)
  const groupKeys = new Set(Object.keys(PromptClass.fieldGroups ?? {}))

  for (const [gKey, group] of Object.entries(PromptClass.fieldGroups ?? {})) {
    for (const fieldName of group.fields ?? []) {
      if (!validNames.has(fieldName)) {
        const suggestion = closestMatch(fieldName, validNames)
        issues.push({
          level: 'error',
          scope: 'prompt',
          model: modelName,
          attribute: fieldName,
          message: `fieldGroups["${gKey}"].fields references unknown attribute "${fieldName}" on ${modelName}`,
          hint: suggestion
            ? `did you mean "${suggestion}"?`
            : `Known attributes: ${[...validNames].join(', ')}`
        })
      }
    }
  }

  for (const [sKey, section] of Object.entries(PromptClass.sections ?? {})) {
    for (const groupName of section.groups ?? []) {
      if (!groupKeys.has(groupName)) {
        const suggestion = closestMatch(groupName, groupKeys)
        issues.push({
          level: 'error',
          scope: 'prompt',
          model: modelName,
          message: `sections["${sKey}"].groups references unknown fieldGroup "${groupName}"`,
          hint: suggestion
            ? `did you mean "${suggestion}"?`
            : `Known groups: ${[...groupKeys].join(', ')}`
        })
      }
    }
  }

  return issues
}
