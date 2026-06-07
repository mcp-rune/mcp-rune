/**
 * StatefulFormStrategy - Full progressive validation with sections
 *
 * This strategy provides complete state management with:
 * - Section-by-section validation
 * - Progress tracking
 * - Conditional section handling
 * - Next section suggestions
 *
 * Operations:
 * - getDocumentation() - Returns guidance with section info
 * - validateSection(section, fields) - Validates one section
 * - validateFields(fields) - Validates all fields
 * - getProgress(fields) - Returns completion status per section
 * - generateSummary(fields) - Server-generated summary
 * - getDefaults() - Returns default form state
 *
 * Flow: get_prompt -> [validate_section]* -> validate_form -> create_model
 *
 * Best for: Complex forms (20+ fields), many conditionals, field dependencies
 *
 * Example models: Rule, Right, Deal
 */

import * as logger from '#src/runtime/logger.js'

import { BaseFormStrategy } from './base-form-strategy.js'
import type {
  ProgressResult,
  SectionMetadata,
  SectionValidationResult,
  StatefulPromptClass,
  StatefulSummaryResult,
  StatefulValidationResult
} from './form-strategy-definitions.js'
import { HybridFormStrategy } from './hybrid-form-strategy.js'

const log = logger.child({ service: 'form-strategy', formStrategy: 'stateful' })

export class StatefulFormStrategy extends BaseFormStrategy {
  static override type = 'stateful'

  static override getSupportedOperations(): string[] {
    return [
      'getDocumentation',
      'validateSection',
      'validateFields',
      'getProgress',
      'generateSummary',
      'getDefaults'
    ]
  }

  /** Get documentation for the prompt */
  static override getDocumentation(promptInstance: {
    promptContent: string
    constructor: { name: string }
  }): string {
    log.debug('getDocumentation called', {
      promptClass: promptInstance.constructor.name
    })
    const promptContent = promptInstance.promptContent
    log.debug('getDocumentation complete', {
      promptContentLength: promptContent?.length || 0
    })
    return promptContent
  }

  /** Validate a specific section */
  static validateSection(
    promptClass: StatefulPromptClass,
    sectionName: string,
    fields: Record<string, unknown>,
    _context: Record<string, unknown> = {}
  ): SectionValidationResult {
    const fieldGroups = promptClass.fieldGroups || {}
    const group = fieldGroups[sectionName]
    log.debug('validateSection called', {
      section: sectionName,
      fieldCount: Object.keys(fields).length,
      availableSections: Object.keys(fieldGroups)
    })

    if (!group) {
      const result: SectionValidationResult = {
        valid: false,
        error: `Unknown section: ${sectionName}`,
        available_sections: Object.keys(fieldGroups),
        section: sectionName
      }
      log.debug('validateSection complete', {
        section: sectionName,
        valid: false,
        reason: 'unknown_section'
      })
      return result
    }

    const errors: Array<{ field: string; message: string }> = []
    const warnings: string[] = []
    const fieldDefs = promptClass.fieldDefinitions || {}

    // Check conditional - should this section be validated?
    if (group.conditional) {
      const [condField, condValue] = Object.entries(group.conditional)[0]!
      const actualValue = fields[condField!]

      // Handle array of valid values
      const validValues = Array.isArray(condValue) ? condValue : [condValue]
      const conditionMet = validValues.includes(actualValue)

      if (!conditionMet) {
        const result: SectionValidationResult = {
          section: sectionName,
          valid: true,
          skipped: true,
          reason: `Section only applies when ${condField} is ${validValues.join(' or ')}`
        }
        log.debug('validateSection complete', {
          section: sectionName,
          valid: true,
          skipped: true
        })
        return result
      }
    }

    // Validate fields in this section
    for (const fieldName of group.fields) {
      const def = fieldDefs[fieldName!]
      const value = fields[fieldName!]

      // Check required fields (only if section is required and field is required)
      if (def?.required && group.required && (value === undefined || value === '')) {
        errors.push({
          field: fieldName!,
          message: `${def.description || fieldName} is required`
        })
      }

      // Shared field-level validation (enum, type, range, pattern, custom)
      const fieldErrors = this.validateField(fieldName!, value, def, fields, {
        section: sectionName
      })
      for (const message of fieldErrors) {
        errors.push({ field: fieldName!, message })
      }
    }

    // Custom per-section validator function
    if (group.validateSection && typeof group.validateSection === 'function') {
      try {
        group.validateSection(fields, errors, warnings)
      } catch (err) {
        log.error('Custom section validator threw error', {
          section: sectionName,
          error: (err as Error).message
        })
      }
    }

    // Determine next section
    const nextSection = this.getNextSection(promptClass, sectionName, fields)

    const result: SectionValidationResult = {
      section: sectionName,
      valid: errors.length === 0,
      errors,
      warnings,
      next_section: nextSection,
      section_complete: errors.length === 0 && group.fields.some((f) => fields[f!] !== undefined)
    }

    log.debug('validateSection complete', {
      section: sectionName,
      valid: result.valid,
      errorCount: errors.length,
      nextSection,
      sectionComplete: result.section_complete
    })

    return result
  }

  /** Get the next section to fill based on current state */
  static getNextSection(
    promptClass: StatefulPromptClass,
    currentSection: string,
    fields: Record<string, unknown>
  ): string | null {
    const fieldGroups = promptClass.fieldGroups || {}
    const groupNames = Object.keys(fieldGroups)
    const currentIndex = groupNames.indexOf(currentSection)
    log.debug('getNextSection called', {
      currentSection,
      currentIndex,
      totalSections: groupNames.length
    })

    for (let i = currentIndex + 1; i < groupNames.length; i++) {
      const groupName = groupNames[i]!
      const group = fieldGroups[groupName]!

      // Skip if conditional not met
      if (group.conditional) {
        const [condField, condValue] = Object.entries(group.conditional)[0]!
        const actualValue = fields[condField!]
        const validValues = Array.isArray(condValue) ? condValue : [condValue]

        if (!validValues.includes(actualValue)) {
          continue
        }
      }

      log.debug('getNextSection complete', {
        currentSection,
        nextSection: groupName
      })
      return groupName
    }

    log.debug('getNextSection complete', {
      currentSection,
      nextSection: null
    })
    return null // All sections complete
  }

  /** Validate all fields (delegates to HybridFormStrategy) */
  static validateFields(
    promptClass: StatefulPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): StatefulValidationResult {
    log.debug('validateFields called', {
      fieldCount: Object.keys(fields).length
    })

    // Get base validation from HybridFormStrategy
    const result = HybridFormStrategy.validateFields(
      promptClass,
      fields,
      context
    ) as StatefulValidationResult

    // Add section-level progress
    result.progress = this.getProgress(promptClass, fields)

    log.debug('validateFields complete', {
      valid: result.valid,
      readyToSubmit: result.ready_to_submit,
      errorCount: result.errors?.length || 0,
      progressPercentage: result.progress?.overall?.percentage
    })

    return result
  }

  /** Get completion progress by section */
  static getProgress(
    promptClass: StatefulPromptClass,
    fields: Record<string, unknown>
  ): ProgressResult {
    const fieldGroups = promptClass.fieldGroups || {}
    const progress: ProgressResult = {
      sections: {},
      overall: {
        total_sections: 0,
        completed_sections: 0,
        required_complete: true
      }
    }
    log.debug('getProgress called', {
      totalGroups: Object.keys(fieldGroups).length,
      fieldCount: Object.keys(fields).length
    })

    for (const [groupName, group] of Object.entries(fieldGroups)) {
      // Check if section is applicable (conditional)
      let applicable = true
      if (group.conditional) {
        const [condField, condValue] = Object.entries(group.conditional)[0]!
        const actualValue = fields[condField!]
        const validValues = Array.isArray(condValue) ? condValue : [condValue]
        applicable = validValues.includes(actualValue)
      }

      if (!applicable) {
        progress.sections[groupName] = {
          applicable: false,
          reason: 'Conditional not met'
        }
        continue
      }

      const totalFields = group.fields.length
      const filledFields = group.fields.filter(
        (f) => fields[f!] !== undefined && fields[f!] !== ''
      ).length

      const isComplete = filledFields > 0 && filledFields === totalFields
      const isPartial = filledFields > 0 && filledFields < totalFields

      // Get the section title for this group (reverse lookup)
      const sectionForGroup = promptClass.getSectionForGroup
        ? promptClass.getSectionForGroup(groupName)
        : null

      progress.sections[groupName] = {
        applicable: true,
        total_fields: totalFields,
        filled_fields: filledFields,
        complete: isComplete,
        partial: isPartial,
        required: group.required || false,
        title: sectionForGroup?.title || group.context || groupName
      }

      progress.overall.total_sections++
      if (isComplete) {
        progress.overall.completed_sections++
      }

      if (group.required && !isComplete) {
        progress.overall.required_complete = false
      }
    }

    progress.overall.percentage =
      progress.overall.total_sections > 0
        ? Math.round((progress.overall.completed_sections / progress.overall.total_sections) * 100)
        : 0

    log.debug('getProgress complete', {
      totalSections: progress.overall.total_sections,
      completedSections: progress.overall.completed_sections,
      percentage: progress.overall.percentage,
      requiredComplete: progress.overall.required_complete
    })

    return progress
  }

  /** Generate summary (delegates to HybridFormStrategy) */
  static generateSummary(
    promptClass: StatefulPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): StatefulSummaryResult {
    log.debug('generateSummary called', {
      fieldCount: Object.keys(fields).length,
      model: context.model
    })

    const summary = HybridFormStrategy.generateSummary(
      promptClass,
      fields,
      context
    ) as StatefulSummaryResult

    // Add progress to summary
    summary.progress = this.getProgress(promptClass, fields)

    log.debug('generateSummary complete', {
      hasHumanSummary: !!summary.human,
      hasTechnicalSummary: !!summary.technical,
      progressPercentage: summary.progress?.overall?.percentage
    })

    return summary
  }

  /** Get default values for all fields */
  static getDefaults(promptClass: StatefulPromptClass): Record<string, unknown> {
    const fieldDefs = promptClass.fieldDefinitions || {}
    log.debug('getDefaults called', {
      totalFields: Object.keys(fieldDefs).length
    })

    const defaults: Record<string, unknown> = {}
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (def.default !== undefined) {
        defaults[name] = def.default
      }
    }

    log.debug('getDefaults complete', {
      defaultsCount: Object.keys(defaults).length,
      defaultFields: Object.keys(defaults)
    })

    return defaults
  }

  /**
   * Get available sections for a prompt.
   * Uses the sections configuration (first-class citizen) if available,
   * otherwise falls back to fieldGroups for backward compatibility.
   */
  static getSections(promptClass: StatefulPromptClass): SectionMetadata[] {
    const sections = promptClass.sections || {}
    const fieldGroups = promptClass.fieldGroups || {}

    // If sections are defined, use them (first-class citizen)
    if (Object.keys(sections).length > 0) {
      return Object.entries(sections).map(([name, section]) => {
        // Collect all fields from all groups in this section
        const allFields = section.groups.flatMap(
          (groupName) => fieldGroups[groupName]?.fields || []
        )

        // Section is conditional if ANY of its groups are conditional
        const conditionals = section.groups
          .map((groupName) => fieldGroups[groupName]?.conditional)
          .filter(Boolean) as Record<string, unknown>[]
        const conditional = conditionals.length > 0 ? conditionals[0]! : null

        return {
          name,
          title: section.title,
          required: section.required || false,
          conditional,
          fields: allFields,
          groups: section.groups,
          description: section.description
        }
      })
    }

    // Fallback to fieldGroups for backward compatibility
    return Object.entries(fieldGroups).map(([name, group]) => ({
      name,
      title: group.context || name,
      required: group.required || false,
      conditional: group.conditional || null,
      fields: group.fields,
      groups: [name],
      description: group.description
    }))
  }

  static getDescription(): string {
    return `Stateful Strategy: Full progressive validation with sections.
- LLM receives guidance with section information
- Server validates sections individually or all at once
- Progress tracked by section with completion percentage
- Conditional sections handled automatically
- Next section suggestions provided
- Best for complex forms with many fields and dependencies`
  }
}
