/**
 * Shared rendering primitives for prompt generators.
 *
 * Pure functions with no dependency on BasePrompt or PromptContentGenerator.
 * Each takes explicit data as input and returns a markdown string.
 */

/**
 * Convert snake_case name to Title Case.
 * @param {string} name - snake_case string
 * @returns {string} Title Case string
 */
export function titleCase(name) {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Render a markdown field table from field names and definitions.
 * @param {string[]} fields - Array of field names
 * @param {Object} fieldDefinitions - Map of field name → definition
 * @returns {string} Markdown table
 */
export function renderFieldTable(fields, fieldDefinitions) {
  const rows = fields.map((fieldName) => {
    const field = fieldDefinitions[fieldName]
    if (!field) return `| ${fieldName} | No | - |`
    return `| ${fieldName} | ${field.required ? 'Yes' : 'No'} | ${field.description || '-'} |`
  })

  return `| Field | Required | Description |\n|-------|----------|-------------|\n${rows.join('\n')}`
}

/**
 * Render an enum value table from a field definition.
 * @param {string} fieldName - Field name
 * @param {Object} fieldDefinitions - Map of field name → definition
 * @returns {string} Markdown table or empty string
 */
export function renderEnumTable(fieldName, fieldDefinitions) {
  const field = fieldDefinitions[fieldName]
  if (!field?.enumValues) return ''

  const rows = field.enumValues.map((value) => {
    const desc = field.enumDescriptions?.[value] || ''
    const isDefault = field.default === value ? ' **(default)**' : ''
    return `| \`"${value}"\` | ${desc}${isDefault} |`
  })

  return `| Value | Description |\n|-------|-------------|\n${rows.join('\n')}`
}

/**
 * Render enum tables for fields that have enumDescriptions.
 * @param {string[]} fields - Array of field names to check
 * @param {Object} fieldDefinitions - Map of field name → definition
 * @returns {string} Combined enum tables or empty string
 */
export function renderEnumTables(fields, fieldDefinitions) {
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

/**
 * Render extractionExamples as a "Common Patterns" markdown table.
 * @param {Array<{input: string, output: Object}>} examples
 * @returns {string}
 */
export function renderExtractionExamples(examples) {
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
