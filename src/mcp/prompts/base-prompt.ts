/**
 * BasePrompt - Core architecture for field grouping and semantic extraction
 *
 * This base class implements the "Core Strategy: Field Grouping + Semantic Extraction"
 * pattern for scalable complex prompt handling in MCP servers.
 *
 * Key Techniques Implemented:
 * 1. Sections Architecture - First-class citizens for user-facing workflow structure
 * 2. Field Grouping Architecture - Organizes fields into semantic groups for validation
 * 3. Extraction Examples - Declarative NL -> field extraction patterns on fieldGroups
 * 4. Validation + Defaults - Field-level validation and defaults
 * 5. Prompt Content - Domain-specific prompt documentation
 *
 * This is the shared library version. Server-specific BasePrompts should extend this class.
 */

import { getKind } from '#src/mcp/models/kind-metadata.js'

import { generateAttributeReference } from './generators/attribute-reference-generator.js'
import type { FlowSection } from './generators/flow-diagram-generator.js'
import {
  generateFlowDiagram as generateFlowDiagramFromContext,
  renderFlowDiagram
} from './generators/flow-diagram-generator.js'
import { generateGuidance } from './generators/guidance-generator.js'
import type { ExtractionExample } from './generators/helpers.js'
import {
  renderEnumTable as renderEnumTableHelper,
  renderExtractionExamples
} from './generators/helpers.js'
import { generateSection } from './generators/section-generator.js'
import { generateSummary } from './generators/summary-generator.js'

// ---------------------------------------------------------------------------
// Exported type definitions
// ---------------------------------------------------------------------------

export type StrategyType = 'stateless' | 'hybrid' | 'stateful'

export interface Section {
  title: string
  description: string
  required: boolean
  groups: string[]
  askPrompt?: string
  content?: {
    preamble?: string
    intro?: string
    notes?: string[]
  }
}

export interface FieldGroup {
  fields: string[]
  required?: boolean
  context?: string
  description?: string
  conditional?: Record<string, unknown>
  dependencies?: string[]
  askPrompt?: string
  validateSection?: (...args: unknown[]) => unknown
  extractionExamples?: ExtractionExample[]
  content?: {
    intro?: string
    notes?: string[]
  }
}

export interface FieldValidation {
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: RegExp
  patternMessage?: string
  [key: string]: unknown
}

export interface CompletionConfig {
  [key: string]: unknown
}

export interface PromptFieldDefinition {
  type: string
  required: boolean
  description: string
  label?: string
  enumValues?: string[]
  enumDescriptions?: Record<string, string>
  format?: string
  default?: unknown
  examples?: string[]
  validation?: FieldValidation
  validate?: (
    value: unknown,
    allFields: Record<string, unknown>,
    context: Record<string, unknown>
  ) => string | null | undefined
  completion?: CompletionConfig
  prompt_visible?: boolean
  conditional?: boolean
  immutable?: boolean
}

export interface PromptContent {
  type: string
  text: string
}

export interface FormSchemaFieldDefinition {
  type: string
  required: boolean
  description: string
  label?: string
  examples?: string[]
  enumValues?: string[]
  format?: string
  default?: unknown
  completion?: CompletionConfig
  validation?: Record<string, unknown>
}

export interface FormSchema {
  name: string
  title: string
  description: string
  modelName: string | null
  strategy: string
  fieldDefinitions: Record<string, FormSchemaFieldDefinition>
  fieldGroups: Record<string, FieldGroup>
  sections: Record<string, Section>
  defaults: Record<string, unknown>
}

/**
 * Structural interface describing the static shape of a BasePrompt subclass.
 * Used by generator functions that receive `{ promptClass: ... }` context.
 */
export interface PromptClassLike {
  strategy: StrategyType
  sections: Record<string, Section>
  fieldGroups: Record<string, FieldGroup>
  fieldDefinitions: Record<string, PromptFieldDefinition>
  name?: string
  title?: string
  description?: string
  modelName?: string
}

// ---------------------------------------------------------------------------
// Attribute table row shape (used by generateAttributeTable)
// ---------------------------------------------------------------------------

export interface AttributeRow {
  attr: string
  type: string
  req: boolean
  desc: string
}

export interface OptionRow {
  value: string
  desc: string
}

// ---------------------------------------------------------------------------
// BasePrompt class
// ---------------------------------------------------------------------------

export class BasePrompt {
  /**
   * Assembled prompt content. Subclasses override with a getter that builds
   * the prompt using `PromptContentGenerator` (see strategies guide).
   * Returns an empty string by default so the base class can be instantiated
   * for inspection without throwing.
   */
  get promptContent(): string {
    return ''
  }

  /**
   * Optional per-instance description shown in `prompts/get` responses.
   * Subclasses may override; falls back to the registry entry's description.
   */
  description?: string

  /**
   * Strategy type for this prompt.
   * Override in subclasses: 'stateless', 'hybrid', or 'stateful'.
   */
  static strategy: StrategyType = 'stateless'

  /**
   * Sections define the user-facing workflow structure.
   * Sections are first-class citizens that group multiple fieldGroups.
   * Subclasses SHOULD override this for complex prompts.
   */
  static sections: Record<string, Section> = {}

  /**
   * Field groups organized for validation and technical structure.
   * Subclasses MUST override this.
   */
  static fieldGroups: Record<string, FieldGroup> = {}

  /**
   * Field definitions with validation and extraction hints.
   * Subclasses MUST override this.
   */
  static fieldDefinitions: Record<string, PromptFieldDefinition> = {}

  // ===========================================================================
  // STATIC HELPER METHODS - Generate common prompt sections (token-efficient)
  // ===========================================================================

  /** Generate a compact interactive flow diagram. */
  static generateFlowDiagram(sections: FlowSection[]): string {
    return renderFlowDiagram(sections)
  }

  /** Generate a compact attribute reference table. */
  static generateAttributeTable(attributes: AttributeRow[]): string {
    const rows = attributes.map(
      (a) => `| \`${a.attr}\` | ${a.type} | ${a.req ? 'Yes' : 'No'} | ${a.desc} |`
    )
    return `| Attr | Type | Req | Description |\n|------|------|-----|-------------|\n${rows.join('\n')}`
  }

  /** Generate compact tool usage example. */
  static generateToolExample(
    model: string,
    parentPath: string | undefined,
    attributes: Record<string, unknown>
  ): string {
    const params = parentPath
      ? `model: "${model}", parent_path: "${parentPath}"`
      : `model: "${model}"`
    return `\`\`\`\ncreate_model(${params}, attributes: ${JSON.stringify(attributes, null, 2)})\n\`\`\``
  }

  /** Generate bulk creation guidance (compact version). */
  static generateBulkGuidance(model: string, parentModel: string, childModel?: string): string {
    const lines = [
      '## Bulk Creation',
      '',
      `**Multiple ${model}s:** Find parent ${parentModel} once, then create each ${model} sequentially.`,
      '**ID Chaining:** Each response contains IDs for child resources.'
    ]
    if (childModel) {
      lines.push(`**Hierarchy:** ${parentModel} → ${model} → ${childModel}`)
    }
    lines.push('', 'Summarize all created items at the end.')
    return lines.join('\n')
  }

  /** Generate compact section validation reminder. */
  static generateValidationReminder(model: string, sections: string[]): string {
    return `**Validation:** Call \`validate_form(model: "${model}", section, fields)\` after each section.\nSections: ${sections.join(', ')}`
  }

  /** Generate a 2-column options table for enum values, resources, or selections. */
  static generateOptionsTable(header: string, options: OptionRow[]): string {
    const rows = options.map((o) => `| ${o.value} | ${o.desc} |`)
    return `| ${header} | Description |\n|${'-'.repeat(header.length + 2)}|-------------|\n${rows.join('\n')}`
  }

  /** Get default values for all fields. */
  static getDefaults(): Record<string, unknown> {
    const defaults: Record<string, unknown> = {}
    for (const [fieldName, fieldDef] of Object.entries(this.fieldDefinitions)) {
      if (fieldDef.default !== undefined) {
        defaults[fieldName] = fieldDef.default
      }
    }
    return defaults
  }

  /**
   * Get default form state for the interactive form.
   * Subclasses may override to provide custom defaults.
   */
  getDefaultFormState(): Record<string, unknown> {
    return (this.constructor as typeof BasePrompt).getDefaults()
  }

  /** Get fields for a specific group. */
  static getGroupFields(groupName: string): (PromptFieldDefinition & { name: string })[] {
    const group = this.fieldGroups[groupName]
    if (!group) return []
    return group.fields.map((fieldName) => ({
      ...this.fieldDefinitions[fieldName]!,
      name: fieldName
    }))
  }

  /** Get all fields for a section (across all its groups). */
  static getSectionFields(sectionName: string): (PromptFieldDefinition & { name: string })[] {
    const section = this.sections[sectionName]
    if (!section) return []

    return section.groups.flatMap((groupName) => this.getGroupFields(groupName))
  }

  /** Get all field names for a section. */
  static getSectionFieldNames(sectionName: string): string[] {
    const section = this.sections[sectionName]
    if (!section) return []

    return section.groups.flatMap((groupName) => this.fieldGroups[groupName]?.fields || [])
  }

  /** Get section by group name (reverse lookup). */
  static getSectionForGroup(groupName: string): {
    name: string
    title: string
    description: string
    required: boolean
    groups: string[]
  } | null {
    for (const [sectionName, section] of Object.entries(this.sections)) {
      if (section.groups.includes(groupName)) {
        return { name: sectionName, ...section }
      }
    }
    return null
  }

  /** Get section number (1-based) for display purposes. */
  static getSectionNumber(sectionName: string): number {
    const sectionKeys = Object.keys(this.sections)
    const index = sectionKeys.indexOf(sectionName)
    return index >= 0 ? index + 1 : 0
  }

  /** Generate human-readable summary of form state. */
  static generateHumanReadableSummary(formState: Record<string, unknown>): string {
    const lines: string[] = []

    // Use sections if available, otherwise fieldGroups
    const hasSections = Object.keys(this.sections).length > 0

    if (hasSections) {
      for (const [, section] of Object.entries(this.sections)) {
        const sectionFields = section.groups.flatMap((g) => this.fieldGroups[g]?.fields || [])
        const sectionValues = sectionFields
          .filter((f) => formState[f] !== undefined && formState[f] !== '')
          .map((f) => {
            const def = this.fieldDefinitions[f]
            const rendered = def?.type
              ? getKind(def.type, def.format).describe(formState[f], {
                  format: def.format,
                  enumValues: def.enumValues
                })
              : String(formState[f])
            return `  - ${def?.description || f}: ${rendered}`
          })

        if (sectionValues.length > 0) {
          lines.push(`\n**${section.title}:**`)
          lines.push(...sectionValues)
        }
      }
    } else {
      for (const [, group] of Object.entries(this.fieldGroups)) {
        const groupValues = group.fields
          .filter((f) => formState[f] !== undefined && formState[f] !== '')
          .map((f) => {
            const def = this.fieldDefinitions[f]
            const rendered = def?.type
              ? getKind(def.type, def.format).describe(formState[f], {
                  format: def.format,
                  enumValues: def.enumValues
                })
              : String(formState[f])
            return `  - ${def?.description || f}: ${rendered}`
          })

        if (groupValues.length > 0) {
          lines.push(`\n**${group.context}:**`)
          lines.push(...groupValues)
        }
      }
    }

    return lines.join('\n')
  }

  /** Generate technical summary (API attributes). */
  static generateTechnicalSummary(
    formState: Record<string, unknown>,
    context: { model?: string } = {}
  ): string {
    const attributes: Record<string, unknown> = {}

    for (const [fieldName, value] of Object.entries(formState)) {
      if (value !== undefined && value !== null && value !== '') {
        attributes[fieldName] = value
      }
    }

    return JSON.stringify(
      {
        model: context.model || 'unknown',
        attributes
      },
      null,
      2
    )
  }

  // ===========================================================================
  // AUTO-GENERATION HELPERS - Derive content from static configuration
  // ===========================================================================

  /**
   * Generate field groups list from static fieldGroups configuration.
   * Eliminates manual duplication in static description.
   */
  static generateFieldGroupsList(): string {
    // Use sections if available
    const hasSections = Object.keys(this.sections).length > 0

    if (hasSections) {
      return Object.entries(this.sections)
        .map(([, section], i) => {
          const requirement = section.required ? 'required' : 'optional'
          const fields = section.groups.flatMap((g) => this.fieldGroups[g]?.fields || []).join(', ')
          return `${i + 1}. **${section.title}** - ${fields} (${requirement})`
        })
        .join('\n')
    }

    const entries = Object.entries(this.fieldGroups)
    if (entries.length === 0) return ''

    return entries
      .map(([groupName, group], i) => {
        const requirement = group.required ? 'required' : 'optional'
        const fields = group.fields.join(', ')
        return `${i + 1}. **${group.context || groupName}** - ${fields} (${requirement})`
      })
      .join('\n')
  }

  /**
   * Generate interactive flow diagram from sections or fieldGroups configuration.
   * Used by getFlowDiagram() to auto-generate from config.
   */
  static generateFlowDiagramFromConfig(options: { includeSummary?: boolean } = {}): string {
    return generateFlowDiagramFromContext({ promptClass: this }, options)
  }

  /**
   * Standard accessor for flow diagram from config.
   * Subclasses should use this in static description instead of defining their own wrapper.
   */
  static getFlowDiagram(): string {
    return this.generateFlowDiagramFromConfig()
  }

  /** Get strategy-specific description intro. */
  static getStrategyIntro(): string {
    switch (this.strategy) {
      case 'stateless':
        return 'Guide for creating'
      case 'hybrid':
        return 'Interactive guide for creating'
      case 'stateful':
        return 'REQUIRED interactive guided prompt for creating'
      default:
        return 'Guide for creating'
    }
  }

  /**
   * Generate stateful guidance instructions (CRITICAL/MANDATORY sections).
   * Only generated for stateful strategy prompts.
   *
   * Best Practices In Use (for developers tuning this prompt):
   *
   * 1. STRUCTURAL ANCHORING
   *    - Always reference section number and name (e.g., "Section 3: Transmission")
   *    - Prevents drift and ensures consistent navigation through the form
   *
   * 2. MANDATORY LANGUAGE REINFORCEMENT
   *    - Use "MANDATORY", "REQUIRED", "NOT optional" for critical behaviors
   *    - Stronger than passive voice; creates behavioral constraints
   *
   * 3. DEFAULT-FIRST PRESENTATION
   *    - Offer default/recommended option first, then alternatives
   *    - Reduces cognitive load; makes 80% of cases faster
   *
   * 4. ANTI-PATTERN PREVENTION
   *    - Explicitly state what NOT to do (forbidden behaviors)
   *    - As important as stating what TO do
   *
   * 5. COMPLETENESS CHECKPOINTS
   *    - Always ask about additional/optional sections before finalizing
   *    - Prevents premature completion
   *
   * 6. DUAL OUTPUT REQUIREMENT
   *    - Present both human-readable AND technical summaries
   *    - Different audiences need different formats; aids debugging
   *
   * 7. DEDICATED CRITICAL SECTIONS
   *    - Important requirements get their own section with rationale
   *    - More effective than inline mentions
   *
   * 8. TURN-TAKING ENFORCEMENT
   *    - Explicit instructions to STOP and wait for user response
   *    - Prevents LLM from racing ahead or assuming answers
   */
  static generateStatefulGuidanceInstructions(modelName: string): string {
    return generateGuidance({ promptClass: this, modelName })
  }

  /**
   * Generate section documentation from fieldGroups configuration.
   */
  static generateSectionDocumentation(
    groupName: string,
    sectionNumber: number,
    modelName: string,
    options: { askPrompt?: string; additionalContent?: string; introOverride?: string } = {}
  ): string {
    return generateSection({ promptClass: this, modelName }, groupName, sectionNumber, options)
  }

  // ===========================================================================
  // LAYER 3 ATOMIC HELPERS - Used by PromptContentGenerator and directly
  // ===========================================================================

  /** Render extractionExamples as a "Common Patterns" markdown table. */
  static _renderExtractionExamples(examples: ExtractionExample[]): string {
    return renderExtractionExamples(examples)
  }

  /**
   * Generate an enum value table from fieldDefinitions + enumDescriptions.
   * Part of Layer 3: Section Documentation (atomic).
   */
  static generateEnumTable(fieldName: string): string {
    return renderEnumTableHelper(fieldName, this.fieldDefinitions)
  }

  /**
   * Generate a standardized attribute reference table from fieldDefinitions.
   * Part of Layer 3: Section Documentation (atomic).
   */
  static generateAttributeReferenceFromConfig(): string {
    return generateAttributeReference({ promptClass: this })
  }

  /**
   * Serialize prompt class metadata into a transport-safe form schema.
   * Used by the custom `prompts/getFormSchema` MCP handler.
   *
   * Handles:
   * - Converting RegExp validation.pattern to string
   * - Stripping function-type validators (server handles those via validate_form)
   * - Including completion config as-is (client uses it for autocomplete)
   */
  static toFormSchema(): FormSchema {
    const fieldDefinitions: Record<string, FormSchemaFieldDefinition> = {}
    for (const [fieldName, def] of Object.entries(this.fieldDefinitions || {})) {
      const fieldSchema: FormSchemaFieldDefinition = {
        type: def.type,
        required: !!def.required,
        description: def.description || ''
      }
      if (def.label) fieldSchema.label = def.label
      if (def.examples) fieldSchema.examples = def.examples
      if (def.enumValues) fieldSchema.enumValues = def.enumValues
      if (def.format) fieldSchema.format = def.format
      if (def.default !== undefined) fieldSchema.default = def.default
      if (def.completion) fieldSchema.completion = def.completion

      // Serialize validation, converting RegExp to string and stripping functions
      if (def.validation) {
        const validation: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(def.validation)) {
          if (val instanceof RegExp) {
            validation[key] = val.source
          } else if (typeof val !== 'function') {
            validation[key] = val
          }
        }
        if (Object.keys(validation).length > 0) {
          fieldSchema.validation = validation
        }
      }

      fieldDefinitions[fieldName] = fieldSchema
    }

    return {
      name: this.name,
      title: (this as unknown as { title?: string }).title || this.name,
      description: (this as unknown as { description?: string }).description || '',
      modelName: (this as unknown as { modelName?: string }).modelName || null,
      strategy: this.strategy || 'stateless',
      fieldDefinitions,
      fieldGroups: this.fieldGroups || {},
      sections: this.sections || {},
      defaults: this.getDefaults()
    }
  }

  /**
   * Generate a standard summary template for stateful prompts.
   * Part of Layer 3: Section Documentation (atomic).
   */
  static generateSummaryTemplate(modelName: string): string {
    return generateSummary({ modelName })
  }
}
