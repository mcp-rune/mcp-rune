/**
 * HybridStrategy - Documentation + validation before submit
 *
 * This strategy provides documentation and validates all fields
 * before submission, but doesn't track progress by section.
 *
 * Operations:
 * - getDocumentation() - Returns guidance
 * - validateFields(fields) - Validates all fields at once
 * - generateSummary(fields) - Server-generated summary
 *
 * Flow: get_prompt -> LLM guides -> validate_form -> create_model
 *
 * Best for: Medium complexity (10-20 fields), some conditionals,
 *           want validation without full state management
 *
 * Example models: Series, Episode
 */

import { getKind } from '#src/mcp/models/kinds/index.js'
import * as logger from '#src/runtime/logger.js'

import type { FieldGroup, PromptFieldDefinition } from '../base-prompt.js'
import { BaseStrategy } from './base-strategy.js'

/** Validation error entry */
interface ValidationError {
  field: string
  message: string
}

/** Result from validateFields */
export interface ValidationResult {
  valid: boolean
  ready_to_submit: boolean
  errors: ValidationError[]
  warnings: string[]
  computed: Record<string, unknown>
  fields: Record<string, unknown>
}

/** Result from generateSummary */
export interface SummaryResult {
  human: string
  technical: TechnicalSummary
  progress?: unknown
}

interface TechnicalSummary {
  model: string
  parent_path: string | undefined
  attributes: Record<string, unknown>
}

/** Prompt class shape used by strategy methods */
interface PromptClassLike {
  fieldDefinitions?: Record<string, PromptFieldDefinition>
  fieldGroups?: Record<string, FieldGroup>
  crossSectionValidation?: (
    fields: Record<string, unknown>,
    errors: ValidationError[],
    warnings: string[]
  ) => void
  getSectionForGroup?: (groupName: string) => { title: string } | null
}

export class HybridStrategy extends BaseStrategy {
  static override type = 'hybrid'

  static override getSupportedOperations(): string[] {
    return ['getDocumentation', 'validateFields', 'generateSummary']
  }

  /** Get documentation for the prompt */
  static override getDocumentation(promptInstance: {
    promptContent: string
    constructor: { name: string }
  }): string {
    const promptContent = promptInstance.promptContent

    logger.debug('getDocumentation called', {
      service: 'strategy',
      strategy: 'hybrid',
      promptClass: promptInstance.constructor.name,
      promptContentLength: promptContent?.length || 0
    })

    return promptContent
  }

  /** Validate all fields at once */
  static validateFields(
    promptClass: PromptClassLike,
    fields: Record<string, unknown>,
    _context: Record<string, unknown> = {}
  ): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: string[] = []
    const computed: Record<string, unknown> = {}

    const fieldDefs = promptClass.fieldDefinitions || {}

    logger.debug('validateFields called', {
      service: 'strategy',
      strategy: 'hybrid',
      fieldCount: Object.keys(fields).length,
      definedFieldCount: Object.keys(fieldDefs).length
    })

    // 1. Check required fields
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (def.required && (fields[name] === undefined || fields[name] === '')) {
        errors.push({
          field: name,
          message: `${def.description || name} is required`
        })
        logger.debug('validateFields required field missing', {
          service: 'strategy',
          strategy: 'hybrid',
          field: name
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
        logger.debug('validateFields cross-section validation executed', {
          service: 'strategy',
          strategy: 'hybrid',
          errorsAfter: errors.length,
          warningsAfter: warnings.length
        })
      } catch (err) {
        logger.error('Cross-section validator threw error', {
          service: 'strategy',
          strategy: 'hybrid',
          error: (err as Error).message
        })
      }
    }

    // 4. Apply defaults for missing optional fields
    for (const [name, def] of Object.entries(fieldDefs)) {
      if (fields[name] === undefined && def.default !== undefined) {
        computed[name] = def.default
        warnings.push(`Using default for ${name}: ${def.default}`)
        logger.debug('validateFields applying default', {
          service: 'strategy',
          strategy: 'hybrid',
          field: name,
          defaultValue: def.default
        })
      }
    }

    // 5. Check if ready to submit (all required fields present)
    const requiredFields = Object.entries(fieldDefs)
      .filter(([, def]) => def.required)
      .map(([name]) => name)

    const readyToSubmit =
      errors.length === 0 &&
      requiredFields.every((f) => fields[f] !== undefined && fields[f] !== '')

    logger.debug('validateFields complete', {
      service: 'strategy',
      strategy: 'hybrid',
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

  /** Generate human and technical summary */
  static generateSummary(
    promptClass: PromptClassLike,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): SummaryResult {
    logger.debug('generateSummary called', {
      service: 'strategy',
      strategy: 'hybrid',
      fieldCount: Object.keys(fields).length,
      model: context.model
    })

    const humanSummary = this.generateHumanSummary(promptClass, fields)
    const technicalSummary = this.generateTechnicalSummary(promptClass, fields, context)

    logger.debug('generateSummary complete', {
      service: 'strategy',
      strategy: 'hybrid',
      humanSummaryLength: humanSummary?.length || 0,
      technicalAttributeCount: Object.keys(technicalSummary?.attributes || {}).length
    })

    return {
      human: humanSummary,
      technical: technicalSummary
    }
  }

  /** Generate human-readable summary */
  static generateHumanSummary(
    promptClass: PromptClassLike,
    fields: Record<string, unknown>
  ): string {
    const fieldDefs = promptClass.fieldDefinitions || {}
    const fieldGroups = promptClass.fieldGroups || {}
    const lines: string[] = []

    // Group fields by their groups if available
    if (Object.keys(fieldGroups).length > 0) {
      for (const [, group] of Object.entries(fieldGroups)) {
        const groupValues = group.fields
          .filter((f) => fields[f] !== undefined && fields[f] !== '')
          .map((f) => {
            const def = fieldDefs[f]
            const rendered = def?.type
              ? getKind(def.type, def.format).describe(fields[f], {
                  format: def.format,
                  enumValues: def.enumValues
                })
              : String(fields[f])
            return `  - ${def?.description || f}: ${rendered}`
          })

        if (groupValues.length > 0) {
          lines.push(`\n**${group.context}:**`)
          lines.push(...groupValues)
        }
      }
    } else {
      // No groups, just list all fields
      for (const [name, value] of Object.entries(fields)) {
        if (value !== undefined && value !== '') {
          const def = fieldDefs[name]
          const rendered = def?.type
            ? getKind(def.type, def.format).describe(value, {
                format: def.format,
                enumValues: def.enumValues
              })
            : String(value)
          lines.push(`- ${def?.description || name}: ${rendered}`)
        }
      }
    }

    return lines.join('\n')
  }

  /** Generate technical summary (API-ready) */
  static generateTechnicalSummary(
    _promptClass: PromptClassLike,
    fields: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): TechnicalSummary {
    const attributes: Record<string, unknown> = {}

    for (const [name, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') {
        attributes[name] = value
      }
    }

    return {
      model: (context.model as string) || 'unknown',
      parent_path: (context.parent_path as string) || undefined,
      attributes
    }
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
