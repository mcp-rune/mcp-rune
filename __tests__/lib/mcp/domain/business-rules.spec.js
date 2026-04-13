import { BusinessRule, RuleSet } from '../../../../lib/mcp/domain/business-rules.js'

describe('lib/mcp/domain/business-rules', () => {
  describe('BusinessRule', () => {
    it('should evaluate passing rule', () => {
      const rule = new BusinessRule({
        name: 'test_rule',
        description: 'Test rule',
        scope: ['model_a'],
        evaluate: (data) => ({
          passed: data.value > 0,
          message: data.value > 0 ? 'OK' : 'Value must be positive'
        })
      })

      const result = rule.evaluate({ value: 5 })
      expect(result.passed).toBe(true)
      expect(result.message).toBe('OK')
    })

    it('should evaluate failing rule', () => {
      const rule = new BusinessRule({
        name: 'test_rule',
        description: 'Test rule',
        scope: ['model_a'],
        evaluate: (data) => ({
          passed: data.value > 0,
          message: data.value > 0 ? 'OK' : 'Value must be positive',
          suggestion: 'Set value to a positive number'
        })
      })

      const result = rule.evaluate({ value: -1 })
      expect(result.passed).toBe(false)
      expect(result.suggestion).toBe('Set value to a positive number')
    })

    it('should handle evaluation errors gracefully', () => {
      const rule = new BusinessRule({
        name: 'error_rule',
        description: 'Throws',
        scope: ['model_a'],
        evaluate: () => {
          throw new Error('Boom')
        }
      })

      const result = rule.evaluate({})
      expect(result.passed).toBe(false)
      expect(result.message).toContain('Rule evaluation error: Boom')
    })

    it('should default severity to error', () => {
      const rule = new BusinessRule({
        name: 'r',
        description: 'd',
        scope: ['m'],
        evaluate: () => ({ passed: true, message: 'ok' })
      })
      expect(rule.severity).toBe('error')
    })

    it('should accept custom severity and tags', () => {
      const rule = new BusinessRule({
        name: 'r',
        description: 'd',
        scope: ['m'],
        severity: 'warning',
        tags: ['tag1'],
        evaluate: () => ({ passed: true, message: 'ok' })
      })
      expect(rule.severity).toBe('warning')
      expect(rule.tags).toEqual(['tag1'])
    })
  })

  describe('RuleSet', () => {
    let ruleSet

    beforeEach(() => {
      ruleSet = new RuleSet([
        new BusinessRule({
          name: 'positive_value',
          description: 'Value must be positive',
          scope: ['model_a'],
          severity: 'error',
          tags: ['validation'],
          evaluate: (data) => ({
            passed: !data.value || data.value > 0,
            message: data.value > 0 ? 'Value is positive' : 'Value must be positive'
          })
        }),
        new BusinessRule({
          name: 'has_name',
          description: 'Name is recommended',
          scope: ['model_a', 'model_b'],
          severity: 'warning',
          tags: ['quality'],
          evaluate: (data) => ({
            passed: !!data.name,
            message: data.name ? 'Has name' : 'Name is recommended',
            suggestion: data.name ? undefined : 'Add a name'
          })
        }),
        new BusinessRule({
          name: 'b_only',
          description: 'B-specific rule',
          scope: ['model_b'],
          severity: 'info',
          evaluate: () => ({ passed: true, message: 'B checked' })
        })
      ])
    })

    it('should get rules for a specific model', () => {
      expect(ruleSet.getRulesForModel('model_a')).toHaveLength(2)
      expect(ruleSet.getRulesForModel('model_b')).toHaveLength(2)
      expect(ruleSet.getRulesForModel('model_c')).toHaveLength(0)
    })

    it('should get rules by tag', () => {
      expect(ruleSet.getRulesByTag('validation')).toHaveLength(1)
      expect(ruleSet.getRulesByTag('quality')).toHaveLength(1)
    })

    it('should evaluate all applicable rules and pass', () => {
      const result = ruleSet.evaluate('model_a', { value: 5, name: 'Test' })
      expect(result.passed).toBe(true)
      expect(result.results).toHaveLength(2)
      expect(result.results.every((r) => r.passed)).toBe(true)
    })

    it('should fail when an error-severity rule fails', () => {
      const result = ruleSet.evaluate('model_a', { value: -1, name: 'Test' })
      expect(result.passed).toBe(false)
      const failedError = result.results.find((r) => !r.passed && r.severity === 'error')
      expect(failedError).toBeDefined()
    })

    it('should pass even if warning-severity rule fails', () => {
      const result = ruleSet.evaluate('model_a', { value: 5 })
      // positive_value passes (value > 0), has_name fails (no name) but is warning
      expect(result.passed).toBe(true)
      const failedWarning = result.results.find((r) => !r.passed && r.severity === 'warning')
      expect(failedWarning).toBeDefined()
      expect(failedWarning.suggestion).toBe('Add a name')
    })

    it('should describe rules for a model', () => {
      const descriptions = ruleSet.describeRules('model_a')
      expect(descriptions).toHaveLength(2)
      expect(descriptions[0]).toHaveProperty('name')
      expect(descriptions[0]).toHaveProperty('description')
      expect(descriptions[0]).toHaveProperty('severity')
    })

    it('should include rule metadata in results', () => {
      const result = ruleSet.evaluate('model_a', { value: 5, name: 'Test' })
      expect(result.results[0]).toHaveProperty('rule')
      expect(result.results[0]).toHaveProperty('description')
      expect(result.results[0]).toHaveProperty('severity')
    })
  })
})
