import { InMemoryDomainAdapter } from '../../../../../src/mcp/domain/adapters/inmemory.js'
import { BusinessRule } from '../../../../../src/mcp/domain/business-rules.js'
import { DomainRegistry } from '../../../../../src/mcp/domain/registry.js'
import { CheckBusinessRulesTool } from '../../../../../src/mcp/tools/domain/check-business-rules-tool.js'

function createTestRegistry() {
  return new DomainRegistry({
    adapter: new InMemoryDomainAdapter({
      rules: [
        new BusinessRule({
          name: 'positive_value',
          description: 'Value must be positive',
          scope: ['model_a'],
          severity: 'error',
          evaluate: (data) => ({
            passed: !data.value || (data.value as number) > 0,
            message: (data.value as number) > 0 ? 'Value is positive' : 'Value must be positive',
            suggestion: (data.value as number) > 0 ? undefined : 'Use a positive number'
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
      ]
    })
  })
}

describe('CheckBusinessRulesTool', () => {
  let tool

  beforeEach(() => {
    tool = new CheckBusinessRulesTool({ domainRegistry: createTestRegistry() })
  })

  it('is a domain-registry-gated, no-auth tool', () => {
    expect(tool.name).toBe('check_business_rules')
    expect(CheckBusinessRulesTool.requiresDomainRegistry).toBe(true)
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
