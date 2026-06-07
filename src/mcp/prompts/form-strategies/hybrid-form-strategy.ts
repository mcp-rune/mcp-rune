/**
 * HybridFormStrategy - Documentation + validation before submit
 *
 * This strategy provides documentation and validates all fields
 * before submission, but doesn't track progress by section.
 *
 * Operations:
 * - getDocumentation() - Returns guidance
 * - validateFields(fields) - Validates all fields at once
 * - generateSummary(fields) - Server-generated summary (via injected renderer)
 *
 * Flow: get_prompt -> LLM guides -> validate_form -> create_model
 *
 * Best for: Medium complexity (10-20 fields), some conditionals,
 *           want validation without full state management
 *
 * Example models: Series, Episode
 */

import * as logger from '#src/runtime/logger.js'

import { BaseFormStrategy } from './base-form-strategy.js'
import { defaultFormSummaryRenderer } from './default-form-summary-renderer.js'
import type {
  FormSummaryRenderer,
  HybridPromptClass,
  SummaryResult,
  ValidationError,
  ValidationResult
} from './form-strategy-definitions.js'

const log = logger.child({ service: 'form-strategy', formStrategy: 'hybrid' })

export class HybridFormStrategy extends BaseFormStrategy {
  static override type = 'hybrid'

  static override getSupportedOperations(): string[] {
    return ['getDocumentation', 'validateFields', 'generateSummary']
  }

  /** Get documentation for the prompt */
  static override getDocumentation(promptInstance: {
    promptContent: string
    constructor: { name: string }
  }): string {
    return promptInstance.promptContent
  }

  /** Validate all fields at once */
  static validateFields(
    promptClass: HybridPromptClass,
    fields: Record<string, unknown>,
    _context: Record<string, unknown> = {}
  ): ValidationResult {
    const fieldDefs = promptClass.fieldDefinitions || {}
    log.debug('validateFields called', {
      fieldCount: Object.keys(fields).length,
      definedFieldCount: Object.keys(fieldDefs).length
    })

    const errors: ValidationError[] = []
    const warnings: string[] = []
    const computed: Record<string, unknown> = {}

    // 1. Check required fields
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (def.required && (fields[name] === undefined || fields[name] === '')) {
        errors.push({
          field: name,
          message: `${def.description || name} is required`
        })
      }
    }

    // 2. Validate each field (enum, type, range, pattern, custom)
    for (const [name, value] of Object.entries(fields)) {
      const def = fieldDefs[name]
      const fieldErrors = this.validateField(name, value, def, fields)
      for (const message of fieldErrors) {
        errors.push({ field: name, message })
      }
    }

    // 3. Cross-section validation (form-level)
    if (
      promptClass.crossSectionValidation &&
      typeof promptClass.crossSectionValidation === 'function'
    ) {
      try {
        promptClass.crossSectionValidation(fields, errors, warnings)
      } catch (err) {
        log.error('Cross-section validator threw error', {
          error: (err as Error).message
        })
      }
    }

    // 4. Apply defaults for missing optional fields
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (fields[name] === undefined && def.default !== undefined) {
        computed[name] = def.default
        warnings.push(`Using default for ${name}: ${def.default}`)
      }
    }

    // 5. Check if ready to submit (all required fields present)
    const requiredFields = Object.entries(fieldDefs)
      .filter(([, def]) => def.required)
      .map(([name]) => name)

    const readyToSubmit =
      errors.length === 0 &&
      requiredFields.every((f) => fields[f] !== undefined && fields[f] !== '')

    log.debug('validateFields complete', {
      valid: errors.length === 0,
      readyToSubmit,
      errorCount: errors.length,
      warningCount: warnings.length,
      computedCount: Object.keys(computed).length
    })

    return {
      valid: errors.length === 0,
      ready_to_submit: readyToSubmit,
      errors,
      warnings,
      computed,
      fields: { ...computed, ...fields }
    }
  }

  /**
   * Build a summary by delegating to the injected renderer. The strategy owns
   * "which prompt + fields are summarizable"; the renderer owns "how to format
   * them." Defaults to `defaultFormSummaryRenderer` for callers that don't
   * thread one through.
   */
  static generateSummary(
    promptClass: HybridPromptClass,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {},
    renderer: FormSummaryRenderer = defaultFormSummaryRenderer
  ): SummaryResult {
    const human = renderer.renderHuman(promptClass, fields)
    const technical = renderer.renderTechnical(promptClass, fields, context)

    log.debug('generateSummary complete', {
      humanSummaryLength: human?.length || 0,
      technicalAttributeCount: Object.keys(technical?.attributes || {}).length
    })

    return { human, technical }
  }

  static getDescription(): string {
    return `Hybrid Strategy: Documentation + validation before submit.
- LLM receives guidance documentation
- Server validates all fields before submission
- Errors and warnings returned together
- Defaults applied for missing optional fields
- Best for medium complexity forms`
  }
}
