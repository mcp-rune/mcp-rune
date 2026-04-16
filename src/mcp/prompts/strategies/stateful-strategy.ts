/**
 * StatefulStrategy - Full progressive validation with sections
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

import * as logger from '#src/services/logger.js'

import type { FieldGroup, PromptFieldDefinition, Section } from '../base-prompt.js'
import { BaseStrategy } from './base-strategy.js'
import type { SummaryResult, ValidationResult } from './hybrid-strategy.js'
import { HybridStrategy } from './hybrid-strategy.js'

/** Section validation result */
interface SectionValidationResult {
  section: string
  valid: boolean
  errors?: Array<{ field: string; message: string }>
  warnings?: string[]
  error?: string
  available_sections?: string[]
  skipped?: boolean
  reason?: string
  next_section?: string | null
  section_complete?: boolean
}

/** Section progress entry */
interface SectionProgress {
  applicable: boolean
  reason?: string
  total_fields?: number
  filled_fields?: number
  complete?: boolean
  partial?: boolean
  required?: boolean
  title?: string
}

/** Overall progress */
interface ProgressResult {
  sections: Record<string, SectionProgress>
  overall: {
    total_sections: number
    completed_sections: number
    required_complete: boolean
    percentage?: number
  }
}

/** Extended validation result with progress */
interface StatefulValidationResult extends ValidationResult {
  progress: ProgressResult
}

/** Extended summary with progress */
interface StatefulSummaryResult extends SummaryResult {
  progress: ProgressResult
}

/** Section metadata */
interface SectionMetadata {
  name: string
  title: string
  required: boolean
  conditional: Record<string, unknown> | null
  fields: string[]
  groups: string[]
  description?: string
}

/** Prompt class shape used by stateful strategy */
interface StatefulPromptClassLike {
  fieldDefinitions?: Record<string, PromptFieldDefinition>
  fieldGroups?: Record<string, FieldGroup>
  sections?: Record<string, Section>
  crossSectionValidation?: (
    fields: Record<string, unknown>,
    errors: Array<{ field: string; message: string }>,
    warnings: string[]
  ) => void
  getSectionForGroup?: (groupName: string) => { title: string } | null
}

export class StatefulStrategy extends BaseStrategy {
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
    const promptContent = promptInstance.promptContent

    logger.debug('getDocumentation called', {
      service: 'strategy',
      strategy: 'stateful',
      promptClass: promptInstance.constructor.name,
      promptContentLength: promptContent?.length || 0
    })

    return promptContent
  }

  /** Validate a specific section */
  static validateSection(
    promptClass: StatefulPromptClassLike,
    sectionName: string,
    fields: Record<string, unknown>,
    _context: Record<string, unknown> = {}
  ): SectionValidationResult {
    const fieldGroups = promptClass.fieldGroups || {}
    const group = fieldGroups[sectionName]

    logger.debug('validateSection called', {
      service: 'strategy',
      strategy: 'stateful',
      section: sectionName,
      fieldCount: Object.keys(fields).length,
      availableSections: Object.keys(fieldGroups)
    })

    if (!group) {
      logger.debug('validateSection unknown section', {
        service: 'strategy',
        strategy: 'stateful',
        section: sectionName,
        error: 'Section not found in fieldGroups'
      })
      return {
        valid: false,
        error: `Unknown section: ${sectionName}`,
        available_sections: Object.keys(fieldGroups),
        section: sectionName
      }
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

      logger.debug('validateSection conditional check', {
        service: 'strategy',
        strategy: 'stateful',
        section: sectionName,
        conditionalField: condField,
        expectedValues: validValues,
        actualValue,
        conditionMet
      })

      if (!conditionMet) {
        return {
          section: sectionName,
          valid: true,
          skipped: true,
          reason: `Section only applies when ${condField} is ${validValues.join(' or ')}`
        }
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

      logger.debug('validateSection field validation', {
        service: 'strategy',
        strategy: 'stateful',
        section: sectionName,
        field: fieldName,
        hasValue: value !== undefined && value !== '',
        valueType: typeof value,
        hasError: fieldErrors.length > 0
      })
    }

    // Custom per-section validator function
    if (group.validateSection && typeof group.validateSection === 'function') {
      try {
        group.validateSection(fields, errors, warnings)
        logger.debug('validateSection custom section validator executed', {
          service: 'strategy',
          strategy: 'stateful',
          section: sectionName,
          errorsAfter: errors.length,
          warningsAfter: warnings.length
        })
      } catch (err) {
        logger.error('Custom section validator threw error', {
          service: 'strategy',
          strategy: 'stateful',
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

    logger.debug('validateSection complete', {
      service: 'strategy',
      strategy: 'stateful',
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
    promptClass: StatefulPromptClassLike,
    currentSection: string,
    fields: Record<string, unknown>
  ): string | null {
    const fieldGroups = promptClass.fieldGroups || {}
    const groupNames = Object.keys(fieldGroups)
    const currentIndex = groupNames.indexOf(currentSection)

    logger.debug('getNextSection called', {
      service: 'strategy',
      strategy: 'stateful',
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
          logger.debug('getNextSection skipping section (conditional not met)', {
            service: 'strategy',
            strategy: 'stateful',
            skippedSection: groupName,
            conditionalField: condField,
            expectedValues: validValues,
            actualValue
          })
          continue
        }
      }

      logger.debug('getNextSection found next', {
        service: 'strategy',
        strategy: 'stateful',
        currentSection,
        nextSection: groupName
      })

      return groupName
    }

    logger.debug('getNextSection complete (no more sections)', {
      service: 'strategy',
      strategy: 'stateful',
      currentSection
    })

    return null // All sections complete
  }

  /** Validate all fields (delegates to HybridStrategy) */
  static validateFields(
    promptClass: StatefulPromptClassLike,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): StatefulValidationResult {
    logger.debug('validateFields called', {
      service: 'strategy',
      strategy: 'stateful',
      fieldCount: Object.keys(fields).length
    })

    // Get base validation from HybridStrategy
    const result = HybridStrategy.validateFields(
      promptClass,
      fields,
      context
    ) as StatefulValidationResult

    // Add section-level progress
    result.progress = this.getProgress(promptClass, fields)

    logger.debug('validateFields complete', {
      service: 'strategy',
      strategy: 'stateful',
      valid: result.valid,
      readyToSubmit: result.ready_to_submit,
      errorCount: result.errors?.length || 0,
      progressPercentage: result.progress?.overall?.percentage
    })

    return result
  }

  /** Get completion progress by section */
  static getProgress(
    promptClass: StatefulPromptClassLike,
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

    logger.debug('getProgress called', {
      service: 'strategy',
      strategy: 'stateful',
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
        logger.debug('getProgress section not applicable', {
          service: 'strategy',
          strategy: 'stateful',
          section: groupName,
          reason: 'Conditional not met'
        })
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

      logger.debug('getProgress section status', {
        service: 'strategy',
        strategy: 'stateful',
        section: groupName,
        filledFields,
        totalFields,
        isComplete,
        isPartial,
        required: group.required || false
      })

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

    logger.debug('getProgress complete', {
      service: 'strategy',
      strategy: 'stateful',
      totalSections: progress.overall.total_sections,
      completedSections: progress.overall.completed_sections,
      percentage: progress.overall.percentage,
      requiredComplete: progress.overall.required_complete
    })

    return progress
  }

  /** Generate summary (delegates to HybridStrategy) */
  static generateSummary(
    promptClass: StatefulPromptClassLike,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): StatefulSummaryResult {
    logger.debug('generateSummary called', {
      service: 'strategy',
      strategy: 'stateful',
      fieldCount: Object.keys(fields).length,
      model: context.model
    })

    const summary = HybridStrategy.generateSummary(
      promptClass,
      fields,
      context
    ) as StatefulSummaryResult

    // Add progress to summary
    summary.progress = this.getProgress(promptClass, fields)

    logger.debug('generateSummary complete', {
      service: 'strategy',
      strategy: 'stateful',
      hasHumanSummary: !!summary.human,
      hasTechnicalSummary: !!summary.technical,
      progressPercentage: summary.progress?.overall?.percentage
    })

    return summary
  }

  /** Get default values for all fields */
  static getDefaults(promptClass: StatefulPromptClassLike): Record<string, unknown> {
    const fieldDefs = promptClass.fieldDefinitions || {}
    const defaults: Record<string, unknown> = {}

    for (const [name, def] of Object.entries(fieldDefs)) {
      if (def.default !== undefined) {
        defaults[name] = def.default
      }
    }

    logger.debug('getDefaults called', {
      service: 'strategy',
      strategy: 'stateful',
      totalFields: Object.keys(fieldDefs).length,
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
  static getSections(promptClass: StatefulPromptClassLike): SectionMetadata[] {
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
