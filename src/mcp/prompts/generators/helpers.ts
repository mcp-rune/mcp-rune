/**
 * Shared rendering primitives for prompt generators.
 *
 * Pure functions with no dependency on BasePrompt or PromptContentGenerator.
 * Each takes explicit data as input and returns a markdown string.
 */

import type { PromptFieldDefinition } from '../prompt-definitions.js'

/** Convert snake_case name to Title Case. */
export function titleCase(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Render a markdown field table from field names and definitions. */
export function renderFieldTable(
  fields: string[],
  fieldDefinitions: Record<string, PromptFieldDefinition>
): string {
  const rows = fields.map((fieldName) => {
    const field = fieldDefinitions[fieldName]
    if (!field) return `| ${fieldName} | No | - |`
    return `| ${fieldName} | ${field.required ? 'Yes' : 'No'} | ${field.description || '-'} |`
  })

  return `| Field | Required | Description |\n|-------|----------|-------------|\n${rows.join('\n')}`
}

/** Render an enum value table from a field definition. */
export function renderEnumTable(
  fieldName: string,
  fieldDefinitions: Record<string, PromptFieldDefinition>
): string {
  const field = fieldDefinitions[fieldName]
  if (!field?.enumValues) return ''

  const rows = field.enumValues.map((value) => {
    const desc = field.enumDescriptions?.[value] || ''
    const isDefault = field.default === value ? ' **(default)**' : ''
    return `| \`"${value}"\` | ${desc}${isDefault} |`
  })

  return `| Value | Description |\n|-------|-------------|\n${rows.join('\n')}`
}

/** Render enum tables for fields that have enumDescriptions. */
export function renderEnumTables(
  fields: string[],
  fieldDefinitions: Record<string, PromptFieldDefinition>
): string {
  return fields
    .filter((fieldName) => {
      const field = fieldDefinitions[fieldName]
      return field?.enumDescriptions && Object.keys(field.enumDescriptions).length > 0
    })
    .map(
      (fieldName) => `**\`${fieldName}\` values:**\n${renderEnumTable(fieldName, fieldDefinitions)}`
    )
    .join('\n\n')
}

export interface ExtractionExample {
  input: string
  output: Record<string, unknown>
}

/** Render extractionExamples as a "Common Patterns" markdown table. */
export function renderExtractionExamples(examples: ExtractionExample[]): string {
  const rows = examples.map(({ input, output }) => {
    const extracted = Object.entries(output)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ')
    return `| "${input}" | ${extracted} |`
  })
  return (
    `**Common Patterns:**\n\n| Input | Extracted |\n|-------|-----------|` + `\n${rows.join('\n')}`
  )
}
