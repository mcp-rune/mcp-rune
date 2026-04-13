import { DomainRegistry } from '../../../../lib/mcp/domain/registry.js'
import { DomainKnowledge, DomainConcept } from '../../../../lib/mcp/domain/knowledge.js'
import { RuleSet, BusinessRule } from '../../../../lib/mcp/domain/business-rules.js'
import { WorkflowRegistry, WorkflowDefinition } from '../../../../lib/mcp/domain/workflows.js'

describe('lib/mcp/domain/registry', () => {
  let registry

  beforeEach(() => {
    const knowledge = new DomainKnowledge({
      concepts: [
        new DomainConcept({
          name: 'test_concept',
          title: 'Test Concept',
          description: 'A test cross-entity concept.',
          models: ['model_a', 'model_b'],
          tags: ['test']
        })
      ],
      models: {
        model_a: {
          description: 'Model A',
          attributes: {
            id: { type: 'string', description: 'ID' },
            value: { type: 'integer', required: true, description: 'Value' }
          },
          associations: {}
        }
      }
    })

    const rules = new RuleSet([
      new BusinessRule({
        name: 'positive_value',
        description: 'Value must be positive',
        scope: ['model_a'],
        severity: 'error',
        evaluate: (data) => ({
          passed: !data.value || data.value > 0,
          message: data.value > 0 ? 'OK' : 'Value must be positive'
        })
      })
    ])

    const workflows = new WorkflowRegistry([
      new WorkflowDefinition({
        name: 'create_a',
        title: 'Create Model A',
        description: 'Create a model_a entity.',
        tags: ['onboarding'],
        models: ['model_a'],
        steps: [{ order: 1, title: 'Step', description: 'Do it' }]
      })
    ])

    registry = new DomainRegistry({ knowledge, rules, workflows })
  })

  describe('getContextForModel', () => {
    it('should compose model metadata, concepts, rules, and workflows', () => {
      const context = registry.getContextForModel('model_a')
      expect(context.model).toBe('model_a')
      expect(context.description).toBe('Model A')
      expect(context.attributes).toHaveLength(2)
      expect(context.concepts).toHaveLength(1)
      expect(context.rules).toHaveLength(1)
      expect(context.rules[0].name).toBe('positive_value')
      expect(context.workflows).toHaveLength(1)
      expect(context.workflows[0].name).toBe('create_a')
    })

    it('should return empty arrays for model with no matching data', () => {
      const context = registry.getContextForModel('unknown')
      expect(context.concepts).toEqual([])
      expect(context.rules).toEqual([])
      expect(context.workflows).toEqual([])
    })
  })

  describe('getConcept', () => {
    it('should return concept by name', () => {
      expect(registry.getConcept('test_concept')).toBeDefined()
    })
  })

  describe('searchConcepts', () => {
    it('should search concepts', async () => {
      expect(await registry.searchConcepts('test')).toHaveLength(1)
    })
  })

  describe('checkRules', () => {
    it('should evaluate rules and return results', () => {
      const result = registry.checkRules('model_a', { value: 5 })
      expect(result.passed).toBe(true)
    })

    it('should detect violations', () => {
      const result = registry.checkRules('model_a', { value: -1 })
      expect(result.passed).toBe(false)
    })
  })

  describe('describeRules', () => {
    it('should describe rules for model', () => {
      const rules = registry.describeRules('model_a')
      expect(rules).toHaveLength(1)
      expect(rules[0].name).toBe('positive_value')
    })
  })

  describe('workflows', () => {
    it('should suggest workflows by goal', async () => {
      expect(await registry.suggestWorkflow('create')).toHaveLength(1)
    })

    it('should get workflow by name', () => {
      expect(registry.getWorkflow('create_a')).toBeDefined()
    })

    it('should get workflows by tag', () => {
      expect(registry.getWorkflowsByTag('onboarding')).toHaveLength(1)
    })
  })
})
