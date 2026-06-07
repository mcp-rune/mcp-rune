/**
 * BaseFormStrategy — abstract base for the three form-strategies.
 *
 * Subclasses (`StatelessFormStrategy`, `HybridFormStrategy`,
 * `StatefulFormStrategy`) declare which operations they support and
 * supply their own `getDocumentation` implementation. They share this
 * class's `validateField` implementation so per-field rules (enum, type,
 * range, pattern, custom validator) stay consistent across hybrid and
 * stateful.
 *
 * Subclass contract:
 * - `static type: string` — variant tag, also the string a prompt class
 *   uses in `static formStrategy = '<tag>'`.
 * - `static getSupportedOperations(): string[]` — names of methods this
 *   strategy supports; consulted by `BaseFormStrategyTool.checkOperation`
 *   before dispatching, so an unsupported call returns a structured error
 *   instead of throwing.
 * - `static getDocumentation(promptInstance): string` — what
 *   `get_prompt_guide` returns.
 *
 * Do not consume this class directly from prompt code; pick a concrete
 * subclass via `static formStrategy = 'stateless' | 'hybrid' | 'stateful'`
 * on your `BasePrompt` subclass.
 */

import { getKind } from '#src/mcp/models/kinds/index.js'

import type { PromptFieldDefinition } from '../prompt-definitions.js'
import type { ValidationContext } from './form-strategy-definitions.js'

export class BaseFormStrategy {
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
