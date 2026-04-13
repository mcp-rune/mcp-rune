import { CheckBusinessRulesTool } from '../../../../../lib/mcp/tools/domain/check-business-rules-tool.js'
import { DomainRegistry } from '../../../../../lib/mcp/domain/registry.js'
import { DomainKnowledge } from '../../../../../lib/mcp/domain/knowledge.js'
import { RuleSet, BusinessRule } from '../../../../../lib/mcp/domain/business-rules.js'
import { WorkflowRegistry } from '../../../../../lib/mcp/domain/workflows.js'
import { TOOL_CATEGORIES } from '../../../../../lib/mcp/tools/categories.js'

function createTestRegistry() {
  return new DomainRegistry({
    knowledge: new DomainKnowledge({ concepts: [], models: {} }),
    rules: new RuleSet([
      new BusinessRule({
        name: 'positive_value',
        description: 'Value must be positive',
        scope: ['model_a'],
        severity: 'error',
        evaluate: (data) => ({
          passed: !data.value || data.value > 0,
          message: data.value > 0 ? 'Value is positive' : 'Value must be positive',
          suggestion: data.value > 0 ? undefined : 'Use a positive number'
        })
      }),
      new BusinessRule({
        name: 'has_name',
        description: 'Name is recommended',
        scope: ['model_a'],
        severity: 'warning',
        evaluate: (data) => ({
          passed: !!data.name,
          message: data.name ? 'Has name' : 'Missing name'
        })
      })
    ]),
    workflows: new WorkflowRegistry([])
  })
}

describe('CheckBusinessRulesTool', () => {
  let tool

  beforeEach(() => {
    tool = new CheckBusinessRulesTool({ domainRegistry: createTestRegistry() })
  })

  it('should have correct name and category', () => {
    expect(tool.name).toBe('check_business_rules')
    expect(CheckBusinessRulesTool.category).toBe(TOOL_CATEGORIES.DOMAIN)
    expect(CheckBusinessRulesTool.requiresAuth).toBe(false)
  })

  it('should pass when all rules pass', async () => {
    const result = await tool.execute({
      model: 'model_a',
      data: { value: 5, name: 'Test' }
    })
    const text = result.content[0].text
    expect(text).toContain('PASSED')
    expect(text).toContain('Passed')
  })

  it('should fail on error-severity rule violations', async () => {
    const result = await tool.execute({
      model: 'model_a',
      data: { value: -1, name: 'Test' }
    })
    const text = result.content[0].text
    expect(text).toContain('FAILED')
    expect(text).toContain('Errors (must fix)')
    expect(text).toContain('positive_value')
  })

  it('should show warnings separately', async () => {
    const result = await tool.execute({
      model: 'model_a',
      data: { value: 5 }
    })
    const text = result.content[0].text
    // Overall passes (warnings don't fail), but warnings shown
    expect(text).toContain('PASSED')
    expect(text).toContain('Warnings (should fix)')
    expect(text).toContain('has_name')
  })

  it('should handle model with no rules', async () => {
    const result = await tool.execute({
      model: 'model_b',
      data: { foo: 'bar' }
    })
    expect(result.content[0].text).toContain('No business rules defined')
  })

  it('should throw without domain registry', async () => {
    const toolNoRegistry = new CheckBusinessRulesTool({})
    await expect(toolNoRegistry.execute({ model: 'a', data: {} })).rejects.toThrow(
      'No domain registry'
    )
  })
})
