/**
 * Attribute Reference Generator
 *
 * Generates a markdown attribute reference table from fieldDefinitions.
 * Pure function — no dependency on BasePrompt or PromptContentGenerator.
 *
 * @param {{ promptClass: { fieldDefinitions: Object } }} context
 * @returns {string} Markdown attribute reference section
 */
export function generateAttributeReference(context) {
  const fields = context.promptClass.fieldDefinitions
  const rows = Object.entries(fields)
    .filter(([, def]) => def.prompt_visible !== false)
    .map(([name, def]) => {
      const typeStr = def.type
      const requiredStr = def.required ? 'Yes' : def.conditional ? 'Conditional' : 'No'
      let validValues = ''
      if (def.enumValues) {
        validValues = def.enumValues
          .map((v) => (def.default === v ? `**"${v}"**` : `"${v}"`))
          .join(', ')
      } else if (def.format) {
        validValues = def.format
      } else if (def.examples) {
        validValues = def.examples.slice(0, 2).join(', ')
      }
      return `| \`${name}\` | ${typeStr} | ${requiredStr} | ${validValues} |`
    })
    .join('\n')

  return `## ATTRIBUTE REFERENCE

| Attribute | Type | Required | Valid Values |
|-----------|------|----------|--------------|
${rows}`
}
