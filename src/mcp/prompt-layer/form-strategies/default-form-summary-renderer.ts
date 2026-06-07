/**
 * Default implementation of `FormSummaryRenderer`.
 *
 * Owns the markdown layout for the human summary and the API-payload shape
 * for the technical summary. Lives outside the strategy classes so deployers
 * can supply their own renderer via `ToolRegistry({ summaryRenderer })`
 * without subclassing `HybridFormStrategy` / `StatefulFormStrategy`.
 */

import { getKind } from '#src/mcp/models/kinds/index.js'

import type {
  FormSummaryRenderer,
  HybridPromptClass,
  TechnicalSummary
} from './form-strategy-definitions.js'

export class DefaultFormSummaryRenderer implements FormSummaryRenderer {
  renderHuman(promptClass: HybridPromptClass, fields: Record<string, unknown>): string {
    const fieldDefs = promptClass.fieldDefinitions || {}
    const fieldGroups = promptClass.fieldGroups || {}
    const lines: string[] = []

    if (Object.keys(fieldGroups).length > 0) {
      for (const [, group] of Object.entries(fieldGroups)) {
        const groupValues = group.fields
          .filter((f) => fields[f] !== undefined && fields[f] !== '')
          .map((f) => {
            const def = fieldDefs[f]
            const rendered = def?.type
              ? getKind(def.type, def.format).describe(fields[f], {
                  format: def.format,
                  enumValues: def.enumValues
                })
              : String(fields[f])
            return `  - ${def?.description || f}: ${rendered}`
          })

        if (groupValues.length > 0) {
          lines.push(`\n**${group.context}:**`)
          lines.push(...groupValues)
        }
      }
    } else {
      for (const [name, value] of Object.entries(fields)) {
        if (value !== undefined && value !== '') {
          const def = fieldDefs[name]
          const rendered = def?.type
            ? getKind(def.type, def.format).describe(value, {
                format: def.format,
                enumValues: def.enumValues
              })
            : String(value)
          lines.push(`- ${def?.description || name}: ${rendered}`)
        }
      }
    }

    return lines.join('\n')
  }

  renderTechnical(
    _promptClass: HybridPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): TechnicalSummary {
    const attributes: Record<string, unknown> = {}

    for (const [name, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') {
        attributes[name] = value
      }
    }

    return {
      model: (context.model as string) || 'unknown',
      parent_path: (context.parent_path as string) || undefined,
      attributes
    }
  }
}

/** Process-wide default. Tools fall back to this when no override is registered. */
export const defaultFormSummaryRenderer: FormSummaryRenderer = new DefaultFormSummaryRenderer()
