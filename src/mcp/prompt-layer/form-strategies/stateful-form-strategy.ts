/**
 * StatefulFormStrategy — section-aware validation with progress tracking.
 *
 * Extends `HybridFormStrategy` with the ability to validate one section at
 * a time and report progress per section. Despite the name, the **server
 * holds no persistent state** across calls — "stateful" here refers to the
 * LLM-server protocol exposing section identity and progress, not to
 * server-side session storage. See "State" below.
 *
 * Best for prompts with 20+ fields, many conditional sections, or field
 * dependencies that mean the LLM should validate as it goes rather than
 * all at once at the end.
 *
 * ## Configure on a Prompt class
 *
 *     export class BookPrompt extends BasePrompt {
 *       static formStrategy = 'stateful'
 *
 *       static fieldDefinitions = {
 *         title: { type: 'string', required: true },
 *         author: { type: 'string', required: true },
 *         status: {
 *           type: 'enum',
 *           enumValues: ['unread', 'reading', 'completed'],
 *           default: 'unread'
 *         },
 *         rating: { type: 'integer', validation: { minimum: 1, maximum: 5 } },
 *         notes: { type: 'text' }
 *       }
 *
 *       // Sections are the user-facing structure (numbered steps in the doc).
 *       static sections = {
 *         basics: { title: 'Book Identity', groups: ['identity'], required: true },
 *         progress: { title: 'Reading Status', groups: ['progress_fields'], required: true },
 *         review: { title: 'Review', groups: ['review_fields'], required: false }
 *       }
 *
 *       // Field groups are the validation buckets a section maps to.
 *       // A section can span multiple groups.
 *       static fieldGroups = {
 *         identity: { fields: ['title', 'author'], context: 'Identity', required: true },
 *         progress_fields: { fields: ['status'], context: 'Reading Status', required: true },
 *         review_fields: {
 *           fields: ['rating', 'notes'],
 *           context: 'Review',
 *           required: false,
 *           // Gate this group by an earlier field's value — only ask for a
 *           // rating once the book has actually been finished:
 *           conditional: { status: 'completed' }
 *         }
 *       }
 *
 *       get promptContent() {
 *         return PromptContentBuilder.for(BookPrompt, 'book').standard().build()
 *       }
 *     }
 *
 * Conditional groups (`conditional: { field: value }`) are skipped
 * automatically by `validateSection`, `getProgress`, and `getNextSection`
 * when the gating value doesn't match.
 *
 * ## MCP tools activated
 *
 * | Tool                         | Behavior                                                |
 * | ---------------------------- | ------------------------------------------------------- |
 * | `get_prompt_guide`           | Returns `promptContent` (typically section-aware)       |
 * | `validate_form`              | Validates all fields + attaches per-section progress    |
 * | `validate_form` *(`section:`)* | Validates just that section, returns `next_section`   |
 * | `get_form_summary`           | Human + technical via renderer, with progress appended  |
 * | `get_form_progress`          | Returns completion status per section                   |
 *
 * Expected LLM flow:
 *
 *   1. `get_prompt_guide` — read the section list.
 *   2. For each applicable section: gather its fields, call `validate_form`
 *      with `section:` set, fix any errors, advance to the `next_section`
 *      from the response.
 *   3. Once `validate_form` (no section) returns `ready_to_submit: true`,
 *      call `create_model`.
 *
 * As with hybrid, the prompt's documentation must explicitly instruct the
 * LLM to call `validate_form` per section — nothing forces it.
 *
 * ## State
 *
 * The server keeps **no** persistent state between calls. The LLM is the
 * stateholder: it remembers the values it has gathered and resubmits the
 * full field set (or the section slice) on every validation call. Each
 * `validate_form` and `get_form_progress` call is a pure function of the
 * fields the caller passes in.
 *
 * `get_form_progress` therefore reflects only what the caller has
 * surfaced — it has no memory of what was filled "earlier" if the LLM
 * doesn't include those fields in the request.
 *
 * ## Delegation to HybridFormStrategy
 *
 * `validateFields` and `generateSummary` delegate to `HybridFormStrategy`
 * for the field-level work, then enrich the result with `progress`. The
 * summary renderer (configured via `ToolRegistry({ summaryRenderer })`)
 * applies the same way for both strategies — section progress is appended
 * by stateful after the renderer has produced human + technical halves.
 *
 * Flow:
 *
 *     get_prompt_guide → [ validate_form(section:) ]* →
 *     validate_form → get_form_summary (optional) → create_model
 */

import * as logger from '#src/runtime/logger.js'

import { BaseFormStrategy } from './base-form-strategy.js'
import { defaultFormSummaryRenderer } from './default-form-summary-renderer.js'
import type {
  FormSummaryRenderer,
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
    return promptInstance.promptContent
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

      return groupName
    }

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

  /**
   * Build a summary by delegating to `HybridFormStrategy` and adding
   * section-level progress on top. The renderer arg is threaded through to
   * the hybrid strategy; progress itself is a strategy concern, not a
   * renderer one.
   */
  static generateSummary(
    promptClass: StatefulPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {},
    renderer: FormSummaryRenderer = defaultFormSummaryRenderer
  ): StatefulSummaryResult {
    const summary = HybridFormStrategy.generateSummary(
      promptClass,
      fields,
      context,
      renderer
    ) as StatefulSummaryResult

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
    const defaults: Record<string, unknown> = {}
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (def.default !== undefined) {
        defaults[name] = def.default
      }
    }
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
