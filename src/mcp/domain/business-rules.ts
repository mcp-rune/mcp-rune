/**
 * BusinessRule + RuleSet - Declarative cross-entity business rules
 *
 * Rules validate constraints BETWEEN entities that individual model
 * validation cannot express. Each rule is a data structure with an
 * evaluate function -- testable, auditable, introspectable.
 */

export interface RuleResult {
  passed: boolean
  message: string
  details?: unknown
  suggestion?: string
}

export type RuleSeverity = 'error' | 'warning' | 'info'

export interface BusinessRuleConfig {
  name: string
  description: string
  scope: string[]
  severity?: RuleSeverity
  tags?: string[]
  evaluate: (data: Record<string, unknown>, context?: Record<string, unknown>) => RuleResult
}

export class BusinessRule {
  name: string
  description: string
  scope: string[]
  severity: RuleSeverity
  tags: string[]
  private _evaluate: (
    data: Record<string, unknown>,
    context?: Record<string, unknown>
  ) => RuleResult

  constructor({
    name,
    description,
    scope,
    severity = 'error',
    tags = [],
    evaluate
  }: BusinessRuleConfig) {
    this.name = name
    this.description = description
    this.scope = scope
    this.severity = severity
    this.tags = tags
    this._evaluate = evaluate
  }

  /** Evaluate this rule against data */
  evaluate(data: Record<string, unknown>, context: Record<string, unknown> = {}): RuleResult {
    try {
      return this._evaluate(data, context)
    } catch (error) {
      return {
        passed: false,
        message: `Rule evaluation error: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      }
    }
  }
}

export interface EvaluationResultItem {
  rule: string
  description: string
  passed: boolean
  message: string
  severity: RuleSeverity
  details?: unknown
  suggestion?: string
}

export interface EvaluationResult {
  passed: boolean
  results: EvaluationResultItem[]
}

export class RuleSet {
  rules: BusinessRule[]

  constructor(rules: BusinessRule[] = []) {
    this.rules = rules
  }

  /** Get all rules applicable to a model */
  getRulesForModel(model: string): BusinessRule[] {
    return this.rules.filter((r) => r.scope.includes(model))
  }

  /** Get rules by tag */
  getRulesByTag(tag: string): BusinessRule[] {
    return this.rules.filter((r) => r.tags.includes(tag))
  }

  /** Evaluate all applicable rules for a model against data */
  evaluate(
    model: string,
    data: Record<string, unknown>,
    context: Record<string, unknown> = {}
  ): EvaluationResult {
    const applicableRules = this.getRulesForModel(model)
    const results = applicableRules.map((rule) => {
      const result = rule.evaluate(data, context)
      const item: EvaluationResultItem = {
        rule: rule.name,
        description: rule.description,
        passed: result.passed,
        message: result.message,
        severity: rule.severity
      }
      if (result.details) item.details = result.details
      if (result.suggestion) item.suggestion = result.suggestion
      return item
    })

    const passed = results.every((r) => r.passed || r.severity !== 'error')

    return { passed, results }
  }

  /** Describe rules for a model in human-readable format */
  describeRules(
    model: string
  ): Array<{ name: string; description: string; severity: RuleSeverity }> {
    return this.getRulesForModel(model).map((r) => ({
      name: r.name,
      description: r.description,
      severity: r.severity
    }))
  }
}
