/**
 * BaseStrategy - Interface for form handling strategies
 *
 * Strategies define how forms are processed:
 * - Stateless: Documentation only, no validation
 * - Hybrid: Documentation + validation before submit
 * - Stateful: Full progressive validation with sections
 *
 * All strategies must implement:
 * - getSupportedOperations() - Lists what this strategy can do
 * - getDocumentation(promptInstance) - Returns guidance for LLM
 *
 * Shared field-level validation lives here so hybrid and stateful
 * strategies stay in sync automatically.
 */

import { getKind } from '#src/mcp/models/kinds/index.js'

import type { PromptFieldDefinition } from '../base-prompt.js'

export interface ValidationContext {
  field?: string
  [key: string]: unknown
}

export class BaseStrategy {
  static type = 'base'

  static getSupportedOperations(): string[] {
    throw new Error('Must implement getSupportedOperations()')
  }

  static getDocumentation(_promptInstance: unknown): string {
    throw new Error('Must implement getDocumentation()')
  }

  /** Check if this strategy supports a specific operation. */
  static supportsOperation(operation: string): boolean {
    return this.getSupportedOperations().includes(operation)
  }

  /**
   * Validate a single field against its definition.
   * Shared by hybrid (form-level) and stateful (section-level) strategies.
   */
  static validateField(
    fieldName: string,
    value: unknown,
    def: PromptFieldDefinition | undefined,
    allFields: Record<string, unknown>,
    context: ValidationContext = {}
  ): string[] {
    const errors: string[] = []
    if (!def || value === undefined || value === '') return errors

    // Enum values (scalar or array)
    if (def.enumValues) {
      const values = Array.isArray(value) ? value : [value]
      const invalid = values.filter((v: unknown) => !def.enumValues!.includes(String(v)))
      if (invalid.length > 0) {
        errors.push(
          `Invalid value "${invalid.join(', ')}". Valid options: ${def.enumValues.join(', ')}`
        )
      }
    }

    // Kind-aware type/format checks (integer, boolean, date, datetime, uuid,
    // email, url, json, time, decimal, rating, array) come from
    // src/mcp/models/kinds/ so the rules stay aligned with what the renderer
    // showed to the user.
    const kindError = getKind(def.type, def.format).validate(value, {
      format: def.format,
      enumValues: def.enumValues
    })
    if (kindError) {
      errors.push(`${fieldName} ${kindError}`)
    }

    // Validation property (pattern, length, range)
    if (def.validation) {
      const v = def.validation
      if (v.minLength !== undefined && typeof value === 'string' && value.length < v.minLength) {
        errors.push(`${fieldName} must be at least ${v.minLength} characters`)
      }
      if (v.maxLength !== undefined && typeof value === 'string' && value.length > v.maxLength) {
        errors.push(`${fieldName} must be at most ${v.maxLength} characters`)
      }
      if (v.minimum !== undefined && typeof value === 'number' && value < v.minimum) {
        errors.push(`${fieldName} must be at least ${v.minimum}`)
      }
      if (v.maximum !== undefined && typeof value === 'number' && value > v.maximum) {
        errors.push(`${fieldName} must be at most ${v.maximum}`)
      }
      if (v.pattern && !v.pattern.test(String(value))) {
        errors.push(v.patternMessage || `${fieldName} has invalid format`)
      }
    }

    // Custom per-field validator
    if (def.validate && typeof def.validate === 'function') {
      try {
        const customError = def.validate(value, allFields, { field: fieldName, ...context })
        if (customError) {
          errors.push(customError)
        }
      } catch {
        // Custom validator errors are logged by the caller
      }
    }

    return errors
  }
}
