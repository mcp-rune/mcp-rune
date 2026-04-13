/**
 * BasePrompt - Core architecture for field grouping and semantic extraction
 *
 * This base class implements the "Core Strategy: Field Grouping + Semantic Extraction"
 * pattern for scalable complex prompt handling in MCP servers.
 *
 * Key Techniques Implemented:
 * 1. Sections Architecture - First-class citizens for user-facing workflow structure
 * 2. Field Grouping Architecture - Organizes fields into semantic groups for validation
 * 3. Extraction Examples - Declarative NL → field extraction patterns on fieldGroups
 * 4. Validation + Defaults - Field-level validation and defaults
 * 5. Prompt Content - Domain-specific prompt documentation
 *
 * This is the shared library version. Server-specific BasePrompts should extend this class.
 */

/**
 * Section Definition - First-class citizen for user-facing workflow structure
 * @typedef {Object} Section
 * @property {string} title - Human-readable section title
 * @property {string} description - Section description shown in workflow
 * @property {boolean} required - Whether this section is required
 * @property {string[]} groups - Array of fieldGroup names belonging to this section
 */

/**
 * Field Group Definition - Technical structure for validation and field organization
 * @typedef {Object} FieldGroup
 * @property {string[]} fields - Array of field names in this group
 * @property {boolean} [required] - Whether this group is required
 * @property {Object} [conditional] - Conditional visibility based on field values
 * @property {string[]} [dependencies] - Other groups this group depends on
 * @property {Function} [validateSection] - Custom validation function for this group
 * @property {Array<{input: string, output: Object}>} [extractionExamples] - NL → field extraction examples
 */

/**
 * Field Definition
 * @typedef {Object} FieldDefinition
 * @property {string} name - Field name (attribute name)
 * @property {string} type - Field type: 'string', 'integer', 'boolean', 'datetime', 'enum', 'text'
 * @property {boolean} required - Whether the field is required
 * @property {string[]} [enumValues] - Valid values for enum types
 * @property {string} [format] - Format specification
 * @property {*} [default] - Default value
 * @property {string} description - Human-readable description
 * @property {string[]} [examples] - Example values
 * @property {Object} [validation] - Validation rules
 */

import {
  renderEnumTable as renderEnumTableHelper,
  renderExtractionExamples
} from './generators/helpers.js'
import { generateAttributeReference } from './generators/attribute-reference-generator.js'
import { generateSummary } from './generators/summary-generator.js'
import {
  renderFlowDiagram,
  generateFlowDiagram as generateFlowDiagramFromContext
} from './generators/flow-diagram-generator.js'
import { generateGuidance } from './generators/guidance-generator.js'
import { generateSection } from './generators/section-generator.js'

export class BasePrompt {
  /**
   * Strategy type for this prompt
   * Override in subclasses: 'stateless', 'hybrid', or 'stateful'
   * @type {string}
   */
  static strategy = 'stateless'

  /**
   * Sections define the user-facing workflow structure
   * Sections are first-class citizens that group multiple fieldGroups
   * Subclasses SHOULD override this for complex prompts
   * @type {Object.<string, Section>}
   */
  static sections = {}

  /**
   * Field groups organized for validation and technical structure
   * Subclasses MUST override this
   * @type {Object.<string, FieldGroup>}
   */
  static fieldGroups = {}

  /**
   * Field definitions with validation and extraction hints
   * Subclasses MUST override this
   * @type {Object.<string, FieldDefinition>}
   */
  static fieldDefinitions = {}

  // ===========================================================================
  // STATIC HELPER METHODS - Generate common prompt sections (token-efficient)
  // ===========================================================================

  /**
   * Generate a compact interactive flow diagram
   * @param {Array<{name: string, required: boolean, fields?: string, description?: string}>} sections
   * @returns {string}
   */
  static generateFlowDiagram(sections) {
    return renderFlowDiagram(sections)
  }

  /**
   * Generate a compact attribute reference table
   * @param {Array<{attr: string, type: string, req: boolean, desc: string}>} attributes
   * @returns {string}
   */
  static generateAttributeTable(attributes) {
    const rows = attributes.map(
      (a) => `| \`${a.attr}\` | ${a.type} | ${a.req ? 'Yes' : 'No'} | ${a.desc} |`
    )
    return `| Attr | Type | Req | Description |\n|------|------|-----|-------------|\n${rows.join('\n')}`
  }

  /**
   * Generate compact tool usage example
   * @param {string} model - Model name
   * @param {string} [parentResource] - Optional parent resource path
   * @param {Object} attributes - Example attributes
   * @returns {string}
   */
  static generateToolExample(model, parentResource, attributes) {
    const params = parentResource
      ? `model: "${model}", parent_resource: "${parentResource}"`
      : `model: "${model}"`
    return `\`\`\`\ncreate_model(${params}, attributes: ${JSON.stringify(attributes, null, 2)})\n\`\`\``
  }

  /**
   * Generate bulk creation guidance (compact version)
   * @param {string} model - Model being created
   * @param {string} parentModel - Parent model name
   * @param {string} [childModel] - Optional child model for hierarchy
   * @returns {string}
   */
  static generateBulkGuidance(model, parentModel, childModel) {
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

  /**
   * Generate compact section validation reminder
   * @param {string} model - Model name
   * @param {string[]} sections - Section names
   * @returns {string}
   */
  static generateValidationReminder(model, sections) {
    return `**Validation:** Call \`validate_form(model: "${model}", section, fields)\` after each section.\nSections: ${sections.join(', ')}`
  }

  /**
   * Generate a 2-column options table for enum values, resources, or selections
   * @param {string} header - Column header (e.g., "Type", "Option", "Resource", "Selection")
   * @param {Array<{value: string, desc: string}>} options - Array of option objects
   * @returns {string}
   */
  static generateOptionsTable(header, options) {
    const rows = options.map((o) => `| ${o.value} | ${o.desc} |`)
    return `| ${header} | Description |\n|${'-'.repeat(header.length + 2)}|-------------|\n${rows.join('\n')}`
  }

  /**
   * Get default values for all fields
   * @returns {Object.<string, *>}
   */
  static getDefaults() {
    const defaults = {}
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
   * @returns {Object.<string, *>}
   */
  getDefaultFormState() {
    return this.constructor.getDefaults()
  }

  /**
   * Get fields for a specific group
   * @param {string} groupName - Name of the field group
   * @returns {FieldDefinition[]}
   */
  static getGroupFields(groupName) {
    const group = this.fieldGroups[groupName]
    if (!group) return []
    return group.fields.map((fieldName) => ({
      ...this.fieldDefinitions[fieldName],
      name: fieldName
    }))
  }

  /**
   * Get all fields for a section (across all its groups)
   * @param {string} sectionName - Name of the section
   * @returns {FieldDefinition[]}
   */
  static getSectionFields(sectionName) {
    const section = this.sections[sectionName]
    if (!section) return []

    return section.groups.flatMap((groupName) => this.getGroupFields(groupName))
  }

  /**
   * Get all field names for a section
   * @param {string} sectionName - Name of the section
   * @returns {string[]}
   */
  static getSectionFieldNames(sectionName) {
    const section = this.sections[sectionName]
    if (!section) return []

    return section.groups.flatMap((groupName) => this.fieldGroups[groupName]?.fields || [])
  }

  /**
   * Get section by group name (reverse lookup)
   * @param {string} groupName - Name of the field group
   * @returns {{ name: string, title: string, description: string, required: boolean, groups: string[] } | null}
   */
  static getSectionForGroup(groupName) {
    for (const [sectionName, section] of Object.entries(this.sections)) {
      if (section.groups.includes(groupName)) {
        return { name: sectionName, ...section }
      }
    }
    return null
  }

  /**
   * Get section number (1-based) for display purposes
   * @param {string} sectionName - Name of the section
   * @returns {number} Section number (1-based) or 0 if not found
   */
  static getSectionNumber(sectionName) {
    const sectionKeys = Object.keys(this.sections)
    const index = sectionKeys.indexOf(sectionName)
    return index >= 0 ? index + 1 : 0
  }

  /**
   * Generate human-readable summary of form state
   * @param {Object} formState - Current form state
   * @returns {string}
   */
  static generateHumanReadableSummary(formState) {
    const lines = []

    // Use sections if available, otherwise fieldGroups
    const hasSections = Object.keys(this.sections).length > 0

    if (hasSections) {
      for (const [, section] of Object.entries(this.sections)) {
        const sectionFields = section.groups.flatMap((g) => this.fieldGroups[g]?.fields || [])
        const sectionValues = sectionFields
          .filter((f) => formState[f] !== undefined && formState[f] !== '')
          .map((f) => {
            const def = this.fieldDefinitions[f]
            const value = formState[f]
            return `  - ${def?.description || f}: ${JSON.stringify(value)}`
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
            const value = formState[f]
            return `  - ${def?.description || f}: ${JSON.stringify(value)}`
          })

        if (groupValues.length > 0) {
          lines.push(`\n**${group.context}:**`)
          lines.push(...groupValues)
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * Generate technical summary (API attributes)
   * @param {Object} formState - Current form state
   * @param {Object} context - Additional context (model, parent_resource)
   * @returns {string}
   */
  static generateTechnicalSummary(formState, context = {}) {
    const attributes = {}

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
   * Generate field groups list from static fieldGroups configuration
   * Eliminates manual duplication in static description
   * @returns {string}
   */
  static generateFieldGroupsList() {
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
   * Generate interactive flow diagram from sections or fieldGroups configuration
   * Used by getFlowDiagram() to auto-generate from config
   * @param {Object} options - Optional overrides
   * @param {boolean} options.includeSummary - Whether to include SUMMARY step (default: true)
   * @returns {string}
   */
  static generateFlowDiagramFromConfig(options = {}) {
    return generateFlowDiagramFromContext({ promptClass: this }, options)
  }

  /**
   * Standard accessor for flow diagram from config.
   * Subclasses should use this in static description instead of defining their own wrapper.
   * @returns {string}
   */
  static getFlowDiagram() {
    return this.generateFlowDiagramFromConfig()
  }

  /**
   * Get strategy-specific description intro
   * @returns {string}
   */
  static getStrategyIntro() {
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
   * Generate stateful guidance instructions (CRITICAL/MANDATORY sections)
   * Only generated for stateful strategy prompts
   * @param {string} modelName - The model name for validation examples
   * @returns {string}
   *
   * ============================================================================
   * BEST PRACTICES IN USE (for developers tuning this prompt):
   * ============================================================================
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
   *
   * ============================================================================
   */
  static generateStatefulGuidanceInstructions(modelName) {
    return generateGuidance({ promptClass: this, modelName })
  }

  /**
   * Generate section documentation from fieldGroups configuration
   * @param {string} groupName - The field group name
   * @param {number} sectionNumber - Section number (1-based)
   * @param {string} modelName - Model name for validate_form examples
   * @param {Object} options - Optional customization
   * @param {string} options.askPrompt - Custom "Ask the user:" prompt
   * @param {string} options.additionalContent - Additional content to append
   * @param {string} options.introOverride - Override for content.intro (e.g. auto-generated transformer instructions)
   * @returns {string}
   */
  static generateSectionDocumentation(groupName, sectionNumber, modelName, options = {}) {
    return generateSection({ promptClass: this, modelName }, groupName, sectionNumber, options)
  }

  // ===========================================================================
  // LAYER 3 ATOMIC HELPERS - Used by PromptContentGenerator and directly
  // ===========================================================================

  /**
   * Render extractionExamples as a "Common Patterns" markdown table.
   * @param {Array<{input: string, output: Object}>} examples
   * @returns {string}
   */
  static _renderExtractionExamples(examples) {
    return renderExtractionExamples(examples)
  }

  /**
   * Generate an enum value table from fieldDefinitions + enumDescriptions
   * Part of Layer 3: Section Documentation (atomic)
   *
   * @param {string} fieldName - Field name to generate enum table for
   * @returns {string} Markdown table
   */
  static generateEnumTable(fieldName) {
    return renderEnumTableHelper(fieldName, this.fieldDefinitions)
  }

  /**
   * Generate a standardized attribute reference table from fieldDefinitions
   * Part of Layer 3: Section Documentation (atomic)
   *
   * @returns {string} Markdown attribute reference section
   */
  static generateAttributeReferenceFromConfig() {
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
   *
   * @returns {Object} Transport-safe form schema
   */
  static toFormSchema() {
    const fieldDefinitions = {}
    for (const [fieldName, def] of Object.entries(this.fieldDefinitions || {})) {
      const fieldSchema = {
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
        const validation = {}
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
      title: this.title || this.name,
      description: this.description || '',
      modelName: this.modelName || null,
      strategy: this.strategy || 'stateless',
      fieldDefinitions,
      fieldGroups: this.fieldGroups || {},
      sections: this.sections || {},
      defaults: this.getDefaults()
    }
  }

  /**
   * Generate a standard summary template for stateful prompts
   * Part of Layer 3: Section Documentation (atomic)
   *
   * @param {string} modelName - Model name for validation examples
   * @returns {string} Markdown summary section
   */
  static generateSummaryTemplate(modelName) {
    return generateSummary({ modelName })
  }
}
