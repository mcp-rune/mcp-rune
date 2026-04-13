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
export class BaseStrategy {
  static type = 'base'

  /**
   * Get list of operations this strategy supports
   * @returns {string[]}
   */
  static getSupportedOperations() {
    throw new Error('Must implement getSupportedOperations()')
  }

  /**
   * Get documentation for the prompt
   * @param {Object} _promptInstance - Instance of the prompt class
   * @returns {string}
   */
  static getDocumentation(_promptInstance) {
    throw new Error('Must implement getDocumentation()')
  }

  /**
   * Check if this strategy supports a specific operation
   * @param {string} operation - Operation name
   * @returns {boolean}
   */
  static supportsOperation(operation) {
    return this.getSupportedOperations().includes(operation)
  }

  /**
   * Validate a single field against its definition.
   * Shared by hybrid (form-level) and stateful (section-level) strategies.
   *
   * @param {string} fieldName - Field name
   * @param {*} value - Field value
   * @param {Object} def - Field definition from promptClass.fieldDefinitions
   * @param {Object} allFields - All field values (for custom validators)
   * @param {Object} [context] - Extra context passed to custom validators
   * @returns {string[]} Array of error messages (empty if valid)
   */
  static validateField(fieldName, value, def, allFields, context = {}) {
    const errors = []
    if (!def || value === undefined || value === '') return errors

    // Enum values (scalar or array)
    if (def.enumValues) {
      const values = Array.isArray(value) ? value : [value]
      const invalid = values.filter((v) => !def.enumValues.includes(v))
      if (invalid.length > 0) {
        errors.push(
          `Invalid value "${invalid.join(', ')}". Valid options: ${def.enumValues.join(', ')}`
        )
      }
    }

    // Type checks
    if (def.type === 'integer' && !Number.isInteger(value)) {
      errors.push(`${fieldName} must be an integer`)
    }
    if (def.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${fieldName} must be a boolean`)
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
