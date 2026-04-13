/**
 * BusinessRule + RuleSet - Declarative cross-entity business rules
 *
 * Rules validate constraints BETWEEN entities that individual model
 * validation cannot express. Each rule is a data structure with an
 * evaluate function — testable, auditable, introspectable.
 */

export class BusinessRule {
  /**
   * @param {Object} config
   * @param {string} config.name - Unique rule identifier
   * @param {string} config.description - Human-readable rule description
   * @param {string[]} config.scope - Models this rule applies to
   * @param {string} [config.severity='error'] - 'error' | 'warning' | 'info'
   * @param {string[]} [config.tags] - Tags for filtering
   * @param {Function} config.evaluate - (data, context?) => { passed, message, details?, suggestion? }
   */
  constructor({ name, description, scope, severity = 'error', tags = [], evaluate }) {
    this.name = name
    this.description = description
    this.scope = scope
    this.severity = severity
    this.tags = tags
    this._evaluate = evaluate
  }

  /**
   * Evaluate this rule against data
   * @param {Object} data - Entity data to validate
   * @param {Object} [context] - Additional context (related entities, etc.)
   * @returns {Object} { passed: boolean, message: string, details?: any, suggestion?: string }
   */
  evaluate(data, context = {}) {
    try {
      return this._evaluate(data, context)
    } catch (error) {
      return {
        passed: false,
        message: `Rule evaluation error: ${error.message}`,
        details: { error: error.message }
      }
    }
  }
}

export class RuleSet {
  /**
   * @param {BusinessRule[]} rules
   */
  constructor(rules = []) {
    this.rules = rules
  }

  /**
   * Get all rules applicable to a model
   * @param {string} model - Model name
   * @returns {BusinessRule[]}
   */
  getRulesForModel(model) {
    return this.rules.filter((r) => r.scope.includes(model))
  }

  /**
   * Get rules by tag
   * @param {string} tag
   * @returns {BusinessRule[]}
   */
  getRulesByTag(tag) {
    return this.rules.filter((r) => r.tags.includes(tag))
  }

  /**
   * Evaluate all applicable rules for a model against data
   * @param {string} model - Model name
   * @param {Object} data - Entity data to validate
   * @param {Object} [context] - Additional context
   * @returns {Object} { passed: boolean, results: Array<{ rule, passed, message, severity, suggestion? }> }
   */
  evaluate(model, data, context = {}) {
    const applicableRules = this.getRulesForModel(model)
    const results = applicableRules.map((rule) => {
      const result = rule.evaluate(data, context)
      return {
        rule: rule.name,
        description: rule.description,
        passed: result.passed,
        message: result.message,
        severity: rule.severity,
        ...(result.details && { details: result.details }),
        ...(result.suggestion && { suggestion: result.suggestion })
      }
    })

    const passed = results.every((r) => r.passed || r.severity !== 'error')

    return { passed, results }
  }

  /**
   * Describe rules for a model in human-readable format
   * @param {string} model - Model name
   * @returns {Object[]} Array of { name, description, severity }
   */
  describeRules(model) {
    return this.getRulesForModel(model).map((r) => ({
      name: r.name,
      description: r.description,
      severity: r.severity
    }))
  }
}
