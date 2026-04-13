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

import { BaseStrategy } from './base-strategy.js'
import { HybridStrategy } from './hybrid-strategy.js'
import * as logger from '#lib/services/logger.js'

export class StatefulStrategy extends BaseStrategy {
  static type = 'stateful'

  /**
   * Get list of operations this strategy supports
   * @returns {string[]}
   */
  static getSupportedOperations() {
    return [
      'getDocumentation',
      'validateSection',
      'validateFields',
      'getProgress',
      'generateSummary',
      'getDefaults'
    ]
  }

  /**
   * Get documentation for the prompt
   * @param {Object} promptInstance - Instance of the prompt class
   * @returns {string}
   */
  static getDocumentation(promptInstance) {
    const promptContent = promptInstance.promptContent

    logger.debug('getDocumentation called', {
      service: 'strategy',
      strategy: 'stateful',
      promptClass: promptInstance.constructor.name,
      promptContentLength: promptContent?.length || 0
    })

    return promptContent
  }

  /**
   * Validate a specific section
   * @param {Function} promptClass - The prompt class
   * @param {string} sectionName - Name of the section to validate
   * @param {Object} fields - Current field values
   * @param {Object} _context - Additional context
   * @returns {Object} Section validation result
   */
  static validateSection(promptClass, sectionName, fields, _context = {}) {
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
        available_sections: Object.keys(fieldGroups)
      }
    }

    const errors = []
    const warnings = []
    const fieldDefs = promptClass.fieldDefinitions || {}

    // Check conditional - should this section be validated?
    if (group.conditional) {
      const [condField, condValue] = Object.entries(group.conditional)[0]
      const actualValue = fields[condField]

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
      const def = fieldDefs[fieldName]
      const value = fields[fieldName]

      // Check required fields (only if section is required and field is required)
      if (def?.required && group.required && (value === undefined || value === '')) {
        errors.push({
          field: fieldName,
          message: `${def.description || fieldName} is required`
        })
      }

      // Shared field-level validation (enum, type, range, pattern, custom)
      const fieldErrors = this.validateField(fieldName, value, def, fields, {
        section: sectionName
      })
      for (const message of fieldErrors) {
        errors.push({ field: fieldName, message })
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
          error: err.message
        })
      }
    }

    // Determine next section
    const nextSection = this.getNextSection(promptClass, sectionName, fields)

    const result = {
      section: sectionName,
      valid: errors.length === 0,
      errors,
      warnings,
      next_section: nextSection,
      section_complete: errors.length === 0 && group.fields.some((f) => fields[f] !== undefined)
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

  /**
   * Get the next section to fill based on current state
   * @param {Function} promptClass - The prompt class
   * @param {string} currentSection - Current section name
   * @param {Object} fields - Current field values
   * @returns {string|null} Next section name or null if complete
   */
  static getNextSection(promptClass, currentSection, fields) {
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
      const groupName = groupNames[i]
      const group = fieldGroups[groupName]

      // Skip if conditional not met
      if (group.conditional) {
        const [condField, condValue] = Object.entries(group.conditional)[0]
        const actualValue = fields[condField]
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

  /**
   * Validate all fields (delegates to HybridStrategy)
   * @param {Function} promptClass - The prompt class
   * @param {Object} fields - Field values
   * @param {Object} context - Additional context
   * @returns {Object} Validation result
   */
  static validateFields(promptClass, fields, context = {}) {
    logger.debug('validateFields called', {
      service: 'strategy',
      strategy: 'stateful',
      fieldCount: Object.keys(fields).length
    })

    // Get base validation from HybridStrategy
    const result = HybridStrategy.validateFields(promptClass, fields, context)

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

  /**
   * Get completion progress by section
   * @param {Function} promptClass - The prompt class
   * @param {Object} fields - Current field values
   * @returns {Object} Progress by section
   */
  static getProgress(promptClass, fields) {
    const fieldGroups = promptClass.fieldGroups || {}
    const progress = {
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
        const [condField, condValue] = Object.entries(group.conditional)[0]
        const actualValue = fields[condField]
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
        (f) => fields[f] !== undefined && fields[f] !== ''
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

  /**
   * Generate summary (delegates to HybridStrategy)
   * @param {Function} promptClass - The prompt class
   * @param {Object} fields - Field values
   * @param {Object} context - Additional context
   * @returns {Object} Summary object
   */
  static generateSummary(promptClass, fields, context = {}) {
    logger.debug('generateSummary called', {
      service: 'strategy',
      strategy: 'stateful',
      fieldCount: Object.keys(fields).length,
      model: context.model
    })

    const summary = HybridStrategy.generateSummary(promptClass, fields, context)

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

  /**
   * Get default values for all fields
   * @param {Function} promptClass - The prompt class
   * @returns {Object} Default field values
   */
  static getDefaults(promptClass) {
    const fieldDefs = promptClass.fieldDefinitions || {}
    const defaults = {}

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
   * Get available sections for a prompt
   * Uses the sections configuration (first-class citizen) if available,
   * otherwise falls back to fieldGroups for backward compatibility
   * @param {Function} promptClass - The prompt class
   * @returns {Object[]} List of sections with metadata
   */
  static getSections(promptClass) {
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
          .filter(Boolean)
        const conditional = conditionals.length > 0 ? conditionals[0] : null

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

  /**
   * Get strategy description for documentation
   * @returns {string}
   */
  static getDescription() {
    return `Stateful Strategy: Full progressive validation with sections.
- LLM receives guidance with section information
- Server validates sections individually or all at once
- Progress tracked by section with completion percentage
- Conditional sections handled automatically
- Next section suggestions provided
- Best for complex forms with many fields and dependencies`
  }
}
