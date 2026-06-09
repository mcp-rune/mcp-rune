import { BusinessRule, RuleSet } from '../../../../../src/mcp/domain/business-rules.js'
import { DomainConcept, DomainKnowledge } from '../../../../../src/mcp/domain/knowledge.js'
import { DomainRegistry } from '../../../../../src/mcp/domain/registry.js'
import { WorkflowDefinition, WorkflowRegistry } from '../../../../../src/mcp/domain/workflows.js'
import { GetDomainContextTool } from '../../../../../src/mcp/tools/domain/get-domain-context-tool.js'

function createTestRegistry() {
  return new DomainRegistry({
    knowledge: new DomainKnowledge({
      concepts: [
        new DomainConcept({
          name: 'test_hierarchy',
          title: 'Test Hierarchy',
          description: 'Hierarchy between A and B.',
          models: ['model_a', 'model_b'],
          tags: ['hierarchy'],
          details: { process: 'Create A then B', tips: ['Tip 1'] }
        })
      ],
      models: {
        model_a: {
          description: 'Model A desc',
          attributes: {
            id: { type: 'string', description: 'ID' },
            name: { type: 'string', required: true, description: 'Name' }
          },
          associations: {}
        }
      }
    }),
    rules: new RuleSet([
      new BusinessRule({
        name: 'rule_a',
        description: 'Rule for A',
        scope: ['model_a'],
        evaluate: () => ({ passed: true, message: 'ok' })
      })
    ]),
    workflows: new WorkflowRegistry([
      new WorkflowDefinition({
        name: 'wf_a',
        title: 'Workflow A',
        description: 'A workflow for model_a.',
        models: ['model_a'],
        steps: [{ order: 1, title: 'Step', description: 'Do it' }]
      })
    ])
  })
}

describe('GetDomainContextTool', () => {
  let tool

  beforeEach(() => {
    tool = new GetDomainContextTool({ domainRegistry: createTestRegistry() })
  })

  it('is a domain-registry-gated, no-auth tool', () => {
    expect(tool.name).toBe('get_domain_context')
    expect(GetDomainContextTool.requiresDomainRegistry).toBe(true)
    expect(GetDomainContextTool.requiresAuth).toBe(false)
  })

  it('should return overview when no params provided', async () => {
    const result = await tool.execute({})
    expect(result.content[0].text).toContain('Domain Knowledge Overview')
    expect(result.content[0].text).toContain('Test Hierarchy')
    expect(result.content[0].text).toContain('Workflow A')
  })

  it('should return model context', async () => {
    const result = await tool.execute({ model: 'model_a' })
    const text = result.content[0].text
    expect(text).toContain('model_a')
    expect(text).toContain('Model A desc')
    expect(text).toContain('Test Hierarchy')
    expect(text).toContain('rule_a')
    expect(text).toContain('Workflow A')
  })

  it('should return concept by exact name', async () => {
    const result = await tool.execute({ concept: 'test_hierarchy' })
    const text = result.content[0].text
    expect(text).toContain('Test Hierarchy')
    expect(text).toContain('model_a, model_b')
    expect(text).toContain('Create A then B')
  })

  it('should search concepts by query', async () => {
    const result = await tool.execute({ concept: 'hierarchy' })
    const text = result.content[0].text
    expect(text).toContain('Test Hierarchy')
  })

  it('should handle concept not found', async () => {
    const result = await tool.execute({ concept: 'nonexistent_xyz' })
    expect(result.content[0].text).toContain('No concepts found')
  })

  it('should show Read-Only suffix for read-only models', async () => {
    const registry = new DomainRegistry({
      knowledge: new DomainKnowledge({
        concepts: [],
        models: {
          genre: {
            description: 'Genre entity',
            api: { readOnly: true },
            attributes: {
              id: { type: 'string', description: 'ID' },
              name: { type: 'string', description: 'Name' }
            }
          }
        }
      }),
      rules: new RuleSet([]),
      workflows: new WorkflowRegistry([])
    })
    const readOnlyTool = new GetDomainContextTool({ domainRegistry: registry })
    const result = await readOnlyTool.execute({ model: 'genre' })
    expect(result.content[0].text).toContain('(Read-Only)')
  })

  it('should show Immutable column when attributes have immutable flag', async () => {
    const registry = new DomainRegistry({
      knowledge: new DomainKnowledge({
        concepts: [],
        models: {
          book: {
            description: 'Book entity',
            attributes: {
              id: { type: 'string', description: 'ID' },
              external_id: { type: 'string', immutable: true, description: 'External ID' }
            }
          }
        }
      }),
      rules: new RuleSet([]),
      workflows: new WorkflowRegistry([])
    })
    const immutableTool = new GetDomainContextTool({ domainRegistry: registry })
    const result = await immutableTool.execute({ model: 'book' })
    const text = result.content[0].text
    expect(text).toContain('| Immutable |')
    expect(text).toContain('| Yes |')
  })

  it('should not show Immutable column when no attributes are immutable', async () => {
    const result = await tool.execute({ model: 'model_a' })
    const text = result.content[0].text
    expect(text).not.toContain('Immutable')
  })

  it('should show dual-column Field | API Name when attributes have labels', async () => {
    const registry = new DomainRegistry({
      knowledge: new DomainKnowledge({
        concepts: [],
        models: {
          author: {
            description: 'Author entity',
            attributes: {
              id: { type: 'string', description: 'ID' },
              born_on: { type: 'datetime', label: 'Birth Date', description: 'Date of birth' },
              died_on: { type: 'datetime', label: 'Death Date', description: 'Date of death' }
            }
          }
        }
      }),
      rules: new RuleSet([]),
      workflows: new WorkflowRegistry([])
    })
    const labelTool = new GetDomainContextTool({ domainRegistry: registry })
    const result = await labelTool.execute({ model: 'author' })
    const text = result.content[0].text
    expect(text).toContain('| Field | API Name |')
    expect(text).toContain('| Birth Date | born_on |')
    expect(text).toContain('| Death Date | died_on |')
  })

  it('should append presentation footer to all responses', async () => {
    const result = await tool.execute({ model: 'model_a' })
    const text = result.content[0].text
    expect(text).toContain('**Presentation:**')
    expect(text).toContain('raw attribute name')
  })

  it('should throw without domain registry', async () => {
    const toolNoRegistry = new GetDomainContextTool({})
    await expect(toolNoRegistry.execute({ model: 'a' })).rejects.toThrow('No domain registry')
  })
})
