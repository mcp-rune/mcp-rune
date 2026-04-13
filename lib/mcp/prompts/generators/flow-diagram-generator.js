/**
 * Flow Diagram Generator
 *
 * Generates a compact interactive flow diagram from sections/fieldGroups config.
 * Pure functions — no dependency on BasePrompt or PromptContentGenerator.
 */

/**
 * Generate a compact interactive flow diagram from structured section data.
 * @param {Array<{name: string, required: boolean, fields?: string, description?: string}>} sections
 * @returns {string}
 */
export function renderFlowDiagram(sections) {
  const lines = ['**Flow:** (● required, ○ optional)']
  sections.forEach((s, i) => {
    const req = s.required ? '●' : '○'
    const fields = s.fields ? ` - ${s.fields}` : ''
    lines.push(`${req} ${i + 1}. ${s.name}${fields}`)
    if (s.description) {
      lines.push(`  ↳ ${s.description}`)
    }
  })
  return lines.join('\n')
}

/**
 * Generate a flow diagram from prompt class sections/fieldGroups config.
 *
 * @param {{ promptClass: { sections: Object, fieldGroups: Object } }} context
 * @param {Object} [options]
 * @param {boolean} [options.includeSummary=true] - Whether to include SUMMARY step
 * @returns {string}
 */
export function generateFlowDiagram(context, options = {}) {
  const { includeSummary = true } = options
  const promptClass = context.promptClass

  // Prefer sections (first-class citizen) over fieldGroups
  const hasSections = Object.keys(promptClass.sections).length > 0
  const sections = hasSections
    ? Object.entries(promptClass.sections).map(([, section]) => ({
        name: section.title.toUpperCase(),
        required: section.required || false,
        fields: section.groups.flatMap((g) => promptClass.fieldGroups[g]?.fields || []).join(', '),
        description: section.description
      }))
    : Object.entries(promptClass.fieldGroups).map(([groupName, group]) => ({
        name: (group.context || groupName).toUpperCase(),
        required: group.required || false,
        fields: group.fields.join(', '),
        description: group.description
      }))

  if (includeSummary) {
    sections.push({ name: 'SUMMARY', required: true })
  }

  return renderFlowDiagram(sections)
}
