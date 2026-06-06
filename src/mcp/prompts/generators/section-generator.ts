/**
 * Section Generator
 *
 * Generates section documentation (single-group and multi-group) from
 * prompt class configuration. Includes transformer detection for
 * auto-generating association instructions.
 *
 * Pure functions -- no dependency on BasePrompt or PromptContentGenerator.
 */

import type { TransformerConfig, TransformerEntry } from '../association-transformers.js'
import {
  generateTransformerInstructions,
  getTransformersForFields
} from '../association-transformers.js'
import type { PromptClassLike, Section } from '../prompt-definitions.js'
import {
  renderEnumTables,
  renderExtractionExamples,
  renderFieldTable,
  titleCase
} from './helpers.js'

export interface SectionContext {
  promptClass: PromptClassLike
  modelName: string
  appsEnabled?: boolean
}

export interface SectionOptions {
  askPrompt?: string
  additionalContent?: string
  introOverride?: string
}

export interface AllSectionsOptions {
  skip?: string[]
  customSections?: Record<string, (sectionNum: number) => string>
}

/**
 * Find the section that contains a given group (reverse lookup).
 * Local helper to avoid depending on BasePrompt.
 */
function getSectionForGroup(
  sections: Record<string, Section>,
  groupName: string
): (Section & { name: string }) | null {
  for (const [sectionName, section] of Object.entries(sections || {})) {
    if (section.groups?.includes(groupName)) {
      return { name: sectionName, ...section }
    }
  }
  return null
}

/** Generate documentation for a single field group section. */
export function generateSection(
  context: SectionContext,
  groupName: string,
  sectionNumber: number,
  options: SectionOptions = {}
): string {
  const { promptClass, modelName } = context
  const group = promptClass.fieldGroups[groupName]
  if (!group) return ''

  // Get title from section (first-class citizen) or fallback to group.context or groupName
  const sectionForGroup = getSectionForGroup(promptClass.sections, groupName)
  const sectionTitle = sectionForGroup?.title || group.context || groupName

  const requirement = group.required ? 'REQUIRED' : 'Optional'

  // Generate field table from fieldDefinitions
  const fieldTable = renderFieldTable(group.fields, promptClass.fieldDefinitions)

  // Generate enum tables for fields with enumDescriptions
  const enumTables = renderEnumTables(group.fields, promptClass.fieldDefinitions)

  // Resolve ask prompt: options > section.askPrompt > group.askPrompt > generic fallback
  const askPrompt =
    options.askPrompt ||
    sectionForGroup?.askPrompt ||
    group.askPrompt ||
    `Please provide the ${sectionTitle} information.`

  // Build section content
  let content = `## SECTION ${sectionNumber}: ${sectionTitle} (${requirement})`

  // Add preamble (domain-specific text) before intro/transformer instructions
  if (sectionForGroup?.content?.preamble) {
    content += `\n\n${sectionForGroup.content.preamble}`
  }

  // introOverride (from transformer detection) replaces content.intro
  if (options.introOverride) {
    content += `\n\n${options.introOverride}`
  } else if (sectionForGroup?.content?.intro) {
    content += `\n\n${sectionForGroup.content.intro}`
  }

  content += `\n\n${fieldTable}`

  // Add enum tables if any
  if (enumTables) {
    content += `\n\n${enumTables}`
  }

  // Add extraction examples (Common Patterns table)
  if (group.extractionExamples && group.extractionExamples.length > 0) {
    content += `\n\n${renderExtractionExamples(group.extractionExamples)}`
  }

  // Add section notes from content config
  if (sectionForGroup?.content?.notes && sectionForGroup.content.notes.length > 0) {
    content += `\n\n**Notes:**\n${sectionForGroup.content.notes.map((n: string) => `- ${n}`).join('\n')}`
  }

  content += `\n\n**Ask the user:** "${askPrompt}"`

  content += "\n\n**>>> STOP HERE - WAIT for the user's response before proceeding <<<**"

  // Add DO NOT proceed constraint for required sections
  if (group.required) {
    content += `

**DO NOT call validate_form or proceed until the user has responded.**`
  }

  // Add validate_form reminder
  content += `

**After the user responds**, call validate_form:
\`\`\`
validate_form(model: "${modelName}", section: "${groupName}", fields: { ...current_fields... })
\`\`\``

  // Add any additional content
  if (options.additionalContent) {
    content += `\n\n${options.additionalContent}`
  }

  return content
}

/** Generate documentation for all sections from prompt class config. */
export function generateAllSections(
  context: SectionContext,
  options: AllSectionsOptions = {}
): string {
  const { skip = [], customSections = {} } = options
  const { promptClass } = context

  return Object.entries(promptClass.sections)
    .filter(([sectionName]) => !skip.includes(sectionName))
    .map(([sectionName, section]) => {
      // Recalculate section number accounting for ALL sections (including skipped)
      const allSectionKeys = Object.keys(promptClass.sections)
      const sectionNum = allSectionKeys.indexOf(sectionName) + 1

      // Custom section generator
      if (customSections[sectionName]) {
        return customSections[sectionName]!(sectionNum)
      }

      // Detect transformers covering this section's fields
      const transformerIntro = generateTransformerIntro(context, section)

      // Single-group section: delegate to atomic helper
      if (section.groups.length === 1) {
        return generateSection(
          context,
          section.groups[0]!,
          sectionNum,
          transformerIntro ? { introOverride: transformerIntro } : {}
        )
      }

      // Multi-group section: generate combined documentation
      return generateMultiGroupSection(context, sectionName, section, sectionNum, {
        transformerIntro
      })
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
}

export interface MultiGroupSectionOptions {
  transformerIntro?: string | null
}

/** Generate documentation for a section that spans multiple field groups. */
export function generateMultiGroupSection(
  context: SectionContext,
  _sectionName: string,
  section: Section,
  sectionNum: number,
  options: MultiGroupSectionOptions = {}
): string {
  const { promptClass, modelName } = context
  const { transformerIntro } = options
  const requirement = section.required ? 'REQUIRED' : 'Optional'

  let content = `## SECTION ${sectionNum}: ${section.title} (${requirement})`

  // Render preamble (domain-specific text) before transformer/intro text
  if (section.content?.preamble) {
    content += `\n\n${section.content.preamble}`
  }

  // Transformer intro replaces content.intro when present
  if (transformerIntro) {
    content += `\n\n${transformerIntro}`
  } else if (section.content?.intro) {
    content += `\n\n${section.content.intro}`
  }

  // Render each group as a ### sub-section
  for (const groupName of section.groups) {
    const group = promptClass.fieldGroups[groupName]
    if (!group) continue

    const groupTitle = group.context || titleCase(groupName)
    content += `\n\n### ${groupTitle}`

    if (group.content?.intro) {
      content += `\n\n${group.content.intro}`
    }

    // Group-specific field table
    const fields = group.fields || []
    content += `\n\n${renderFieldTable(fields, promptClass.fieldDefinitions)}`

    // Group-specific enum tables
    const enumTableContent = renderEnumTables(fields, promptClass.fieldDefinitions)
    if (enumTableContent) {
      content += `\n\n${enumTableContent}`
    }

    // Group-specific extraction examples
    if (group.extractionExamples && group.extractionExamples.length > 0) {
      content += `\n\n${renderExtractionExamples(group.extractionExamples)}`
    }

    if (group.content?.notes && group.content.notes.length > 0) {
      content += `\n\n**Notes:**\n${group.content.notes.map((n: string) => `- ${n}`).join('\n')}`
    }
  }

  // Section-level notes (after all groups)
  if (section.content?.notes && section.content.notes.length > 0) {
    content += `\n\n**Notes:**\n${section.content.notes.map((n: string) => `- ${n}`).join('\n')}`
  }

  // Resolve ask prompt
  const askPrompt = section.askPrompt || `Please provide the ${section.title} information.`

  content += `\n\n**Ask the user:** "${askPrompt}"`
  content += "\n\n**>>> STOP HERE - WAIT for the user's response before proceeding <<<**"

  if (section.required) {
    content += '\n\n**DO NOT call validate_form or proceed until the user has responded.**'
  }

  // Add validate_form for each group in the section
  const groupValidations = section.groups
    .map(
      (g) =>
        `validate_form(model: "${modelName}", section: "${g}", fields: { ...current_fields... })`
    )
    .join('\n')

  content += `

**After the user responds**, call validate_form:
\`\`\`
${groupValidations}
\`\`\``

  return content
}

/**
 * Detect transformers covering a section's fields and generate intro text.
 */
export function generateTransformerIntro(context: SectionContext, section: Section): string | null {
  const transformers = (
    context.promptClass as unknown as {
      associationTransformers?: Record<string, TransformerConfig>
    }
  ).associationTransformers
  if (!transformers) return null

  // Collect all field names across the section's groups
  const allFields: string[] = []
  for (const groupName of section.groups) {
    const group = context.promptClass.fieldGroups[groupName]
    if (group?.fields) {
      allFields.push(...group.fields)
    }
  }

  // Find transformers that cover any of these fields
  const sectionTransformers = getTransformersForFields(transformers, allFields)
  if (sectionTransformers.length === 0) return null

  // Generate instructions for each transformer
  const instructions = sectionTransformers
    .map((t: TransformerEntry) =>
      generateTransformerInstructions(t, { appsEnabled: context.appsEnabled ?? false })
    )
    .filter(Boolean) as string[]

  return instructions.length > 0 ? instructions.join('\n\n') : null
}
