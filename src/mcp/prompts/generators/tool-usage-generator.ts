/**
 * Tool Usage Generator
 *
 * Generates tool usage documentation from prompt `static toolUsage` config
 * and model metadata. Auto-derives example attributes, required/optional
 * checklists, and immutable field warnings from fieldDefinitions.
 *
 * Pure function -- no dependency on BasePrompt or PromptContentGenerator.
 */

import type { PromptClassLike, PromptFieldDefinition } from '../base-prompt.js'
import { titleCase } from './helpers.js'

export interface ToolUsageContext {
  promptClass: PromptClassLike
  modelName: string
}

export interface PostCreateStep {
  title: string
  condition?: string
  model: string
  parentTemplate: string
  attributes: Record<string, unknown>
  iterateOver?: string
  skipCondition?: string
}

export interface ToolUsageVariant {
  title: string
  description?: string
  parentResource?: string
  fixedAttributes?: Record<string, unknown>
  exampleAttributes?: Record<string, unknown>
}

export interface AlternativeCreation {
  title?: string
  linkAttribute?: string
  exampleAttributes?: Record<string, unknown>
}

export interface ToolUsageConfig {
  description?: string
  parentResource?: string
  fixedAttributes?: Record<string, unknown>
  exampleAttributes?: Record<string, unknown>
  excludeFromAttributes?: string[]
  postCreateSteps?: PostCreateStep[]
  variants?: ToolUsageVariant[]
  alternativeCreation?: AlternativeCreation
  notes?: string[]
}

/** Generate tool usage documentation. */
export function generateToolUsage(
  context: ToolUsageContext,
  instanceOverrides: Partial<ToolUsageConfig> = {}
): string {
  const { promptClass, modelName } = context
  const config: ToolUsageConfig = {
    ...(promptClass as unknown as { toolUsage: ToolUsageConfig }).toolUsage,
    ...instanceOverrides
  }
  const fieldDefs = promptClass.fieldDefinitions || {}

  // Variants mode: each variant gets its own create_model block
  if (config.variants && config.variants.length > 0) {
    return renderVariantsMode(modelName, config, fieldDefs)
  }

  // Single creation mode
  return renderSingleMode(modelName, config, fieldDefs)
}

// =============================================================================
// RENDERING MODES
// =============================================================================

/** Render single creation mode (Patterns A/B/C/D). */
function renderSingleMode(
  modelName: string,
  config: ToolUsageConfig,
  fieldDefs: Record<string, PromptFieldDefinition>
): string {
  const hasPostCreate = (config.postCreateSteps?.length ?? 0) > 0
  const parts: string[] = []

  parts.push('## TOOL USAGE')

  // Main create block
  const heading = hasPostCreate
    ? `### Step 1: Creating the ${titleCase(modelName)}`
    : `### Creating the ${titleCase(modelName)}`
  parts.push(heading)

  if (config.description) {
    parts.push(config.description)
  }

  parts.push(renderCreateBlock(modelName, config, fieldDefs))

  // Alternative creation (Pattern B: nested models with _link option)
  if (config.alternativeCreation) {
    parts.push(renderAlternativeCreation(modelName, config.alternativeCreation))
  }

  // Required/optional checklists
  parts.push(renderAttributeChecklists(config, fieldDefs))

  // Exclusion notes
  if (config.excludeFromAttributes && config.excludeFromAttributes.length > 0) {
    parts.push(renderExclusionNotes(config.excludeFromAttributes))
  }

  // Immutable field warnings
  const immutableNote = renderImmutableNotes(fieldDefs)
  if (immutableNote) parts.push(immutableNote)

  // Post-create steps (Pattern D)
  if (config.postCreateSteps && config.postCreateSteps.length > 0) {
    config.postCreateSteps.forEach((step, i) => {
      parts.push(renderPostCreateStep(step, i + 2, modelName))
    })
  }

  // Custom notes
  if (config.notes && config.notes.length > 0) {
    parts.push(renderNotes(config.notes))
  }

  return parts.filter(Boolean).join('\n\n')
}

/** Render multiple creation variants mode (Pattern E). */
function renderVariantsMode(
  modelName: string,
  config: ToolUsageConfig,
  fieldDefs: Record<string, PromptFieldDefinition>
): string {
  const parts: string[] = []

  parts.push('## TOOL USAGE')

  // Render each variant
  for (const variant of config.variants!) {
    parts.push(`### ${variant.title}`)
    if (variant.description) {
      parts.push(variant.description)
    }
    const variantConfig: ToolUsageConfig = {
      ...config,
      parentResource: variant.parentResource,
      fixedAttributes: { ...config.fixedAttributes, ...variant.fixedAttributes },
      exampleAttributes: { ...config.exampleAttributes, ...variant.exampleAttributes }
    }
    parts.push(renderCreateBlock(modelName, variantConfig, fieldDefs))
  }

  // Shared checklists after all variants
  parts.push(renderAttributeChecklists(config, fieldDefs))

  // Exclusion notes
  if (config.excludeFromAttributes && config.excludeFromAttributes.length > 0) {
    parts.push(renderExclusionNotes(config.excludeFromAttributes))
  }

  // Immutable field warnings
  const immutableNote = renderImmutableNotes(fieldDefs)
  if (immutableNote) parts.push(immutableNote)

  // Post-create steps
  if (config.postCreateSteps && config.postCreateSteps.length > 0) {
    config.postCreateSteps.forEach((step, i) => {
      parts.push(renderPostCreateStep(step, i + 2, modelName))
    })
  }

  // Custom notes
  if (config.notes && config.notes.length > 0) {
    parts.push(renderNotes(config.notes))
  }

  return parts.filter(Boolean).join('\n\n')
}

// =============================================================================
// RENDERING HELPERS
// =============================================================================

/** Render a create_model code block. */
function renderCreateBlock(
  modelName: string,
  config: ToolUsageConfig,
  fieldDefs: Record<string, PromptFieldDefinition>
): string {
  const attrs = deriveExampleAttributes(config, fieldDefs)
  const attrLines = Object.entries(attrs)
    .map(([key, val]) => `    "${key}": ${JSON.stringify(val)}`)
    .join(',\n')

  let block = '```\nTool: create_model\nParameters:\n'
  block += `  model: "${modelName}"\n`
  if (config.parentResource) {
    block += `  parent_resource: "${config.parentResource}"\n`
  }
  block += `  attributes: {\n${attrLines}\n  }\n\`\`\``
  return block
}

/** Render alternative creation pattern (e.g., using link in attributes). */
function renderAlternativeCreation(modelName: string, alt: AlternativeCreation): string {
  const title = alt.title || 'Alternative: Using link in attributes'
  const attrs: Record<string, unknown> = { ...alt.exampleAttributes }
  if (alt.linkAttribute) {
    attrs[alt.linkAttribute] =
      attrs[alt.linkAttribute] ||
      `https://movida.bebanjo.net/api/${alt.linkAttribute.replace('_link', 's')}/123`
  }

  const attrLines = Object.entries(attrs)
    .map(([key, val]) => `    "${key}": ${JSON.stringify(val)}`)
    .join(',\n')

  return `### ${title}

\`\`\`
Tool: create_model
Parameters:
  model: "${modelName}"
  attributes: {
${attrLines}
  }
\`\`\``
}

/** Derive example attribute values from config and model metadata. */
function deriveExampleAttributes(
  config: ToolUsageConfig,
  fieldDefs: Record<string, PromptFieldDefinition>
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  const exclude = new Set(config.excludeFromAttributes || [])

  // Start with fixed attributes (always included)
  if (config.fixedAttributes) {
    Object.assign(attrs, config.fixedAttributes)
  }

  // Add example values from fieldDefinitions
  for (const [name, def] of Object.entries(fieldDefs)) {
    if (exclude.has(name)) continue
    if (def.prompt_visible === false) continue
    if (attrs[name] !== undefined) continue // Already set by fixedAttributes

    // Use first example value, or explicit override
    if (config.exampleAttributes?.[name] !== undefined) {
      attrs[name] = config.exampleAttributes[name]
    } else if (def.required && def.examples && def.examples.length > 0) {
      attrs[name] = def.examples[0]
    } else if (def.required && def.default !== undefined) {
      attrs[name] = def.default
    }
  }

  // Add any remaining explicit exampleAttributes not yet included
  if (config.exampleAttributes) {
    for (const [name, val] of Object.entries(config.exampleAttributes)) {
      if (!exclude.has(name) && attrs[name] === undefined) {
        attrs[name] = val
      }
    }
  }

  return attrs
}

/** Render required and optional attribute checklists. */
function renderAttributeChecklists(
  config: ToolUsageConfig,
  fieldDefs: Record<string, PromptFieldDefinition>
): string {
  const exclude = new Set(config.excludeFromAttributes || [])
  const parts: string[] = []

  const required: string[] = []
  const optional: string[] = []

  for (const [name, def] of Object.entries(fieldDefs)) {
    if (exclude.has(name)) continue
    if (def.prompt_visible === false) continue

    const desc = def.description || titleCase(name)
    if (def.required) {
      required.push(`- \`${name}\`: REQUIRED - ${desc}`)
    } else {
      optional.push(`- \`${name}\`: ${desc}`)
    }
  }

  if (required.length > 0) {
    parts.push(`### Required Attributes\n${required.join('\n')}`)
  }

  if (optional.length > 0) {
    parts.push(`### Optional Attributes\n${optional.join('\n')}`)
  }

  return parts.join('\n\n')
}

/** Render prompt-only field exclusion notes. */
function renderExclusionNotes(excludeList: string[]): string {
  const fields = excludeList.map((f) => `\`${f}\``).join(', ')
  return `**NOTE:** Do NOT include ${fields} in the API attributes — these are prompt-only fields used for tracking selections locally.`
}

/** Render immutable field warnings from model metadata. */
function renderImmutableNotes(fieldDefs: Record<string, PromptFieldDefinition>): string | null {
  const immutableFields = Object.entries(fieldDefs)
    .filter(([, def]) => def.immutable && def.prompt_visible !== false)
    .map(([name]) => name)

  if (immutableFields.length === 0) return null

  return immutableFields
    .map(
      (name) =>
        `**NOTE:** \`${name}\` is immutable — once set during creation, it cannot be changed via \`update_model\`.`
    )
    .join('\n')
}

/** Render a post-create step (Pattern D). */
function renderPostCreateStep(step: PostCreateStep, stepNum: number, modelName: string): string {
  const parts: string[] = []

  parts.push(`### Step ${stepNum}: ${step.title}`)

  if (step.condition) {
    parts.push(`If ${step.condition}, after creating the ${modelName}:`)
  }

  // Render the tool call
  const attrLines = Object.entries(step.attributes)
    .map(([key, val]) => `    "${key}": ${JSON.stringify(val)}`)
    .join(',\n')

  parts.push(`\`\`\`
Tool: create_model
Parameters:
  model: "${step.model}"
  parent_resource: "${step.parentTemplate}"
  attributes: {
${attrLines}
  }
\`\`\``)

  if (step.iterateOver) {
    parts.push(`Repeat for each item in \`${step.iterateOver}\`.`)
  }

  if (step.skipCondition) {
    parts.push(`If ${step.skipCondition}, skip this step.`)
  }

  return parts.join('\n\n')
}

/** Render custom notes as an important notes section. */
function renderNotes(notes: string[]): string {
  if (notes.length === 1) return `**Important:** ${notes[0]!}`
  return `**Important Notes:**\n${notes.map((n) => `- ${n}`).join('\n')}`
}
