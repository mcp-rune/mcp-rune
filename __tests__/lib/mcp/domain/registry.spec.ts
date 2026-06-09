import { InMemoryDomainAdapter } from '../../../../src/mcp/domain/adapters/inmemory.js'
import { BusinessRule } from '../../../../src/mcp/domain/business-rules.js'
import { DomainConcept } from '../../../../src/mcp/domain/knowledge.js'
import { DomainRegistry } from '../../../../src/mcp/domain/registry.js'
import { WorkflowDefinition } from '../../../../src/mcp/domain/workflows.js'

describe('lib/mcp/domain/registry', () => {
  let registry: DomainRegistry

  beforeEach(() => {
    registry = new DomainRegistry({
      adapter: new InMemoryDomainAdapter({
        concepts: [
          new DomainConcept({
            name: 'test_concept',
            title: 'Test Concept',
            description: 'A test cross-entity concept.',
            models: ['model_a', 'model_b'],
            tags: ['test']
          })
        ],
        rules: [
          new BusinessRule({
            name: 'positive_value',
            description: 'Value must be positive',
            scope: ['model_a'],
            severity: 'error',
            evaluate: (data) => ({
              passed: !data.value || (data.value as number) > 0,
              message: (data.value as number) > 0 ? 'OK' : 'Value must be positive'
            })
          })
        ],
        workflows: [
          new WorkflowDefinition({
            name: 'create_a',
            title: 'Create Model A',
            description: 'Create a model_a entity.',
            tags: ['onboarding'],
            models: ['model_a'],
            steps: [{ order: 1, title: 'Step', description: 'Do it' }]
          })
        ]
      }),
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
  })

  describe('getContextForModel', () => {
    it('should compose model metadata, concepts, rules, and workflows', async () => {
      const context = await registry.getContextForModel('model_a')
      expect(context.model).toBe('model_a')
      expect(context.description).toBe('Model A')
      expect(context.attributes).toHaveLength(2)
      expect(context.concepts).toHaveLength(1)
      expect(context.rules).toHaveLength(1)
      expect(context.rules![0].name).toBe('positive_value')
      expect(context.workflows).toHaveLength(1)
      expect(context.workflows![0].name).toBe('create_a')
    })

    it('should return empty arrays for model with no matching data', async () => {
      const context = await registry.getContextForModel('unknown')
      expect(context.concepts).toEqual([])
      expect(context.rules).toEqual([])
      expect(context.workflows).toEqual([])
    })

    it('should expose attribute labels in field-level metadata', async () => {
      const registry2 = new DomainRegistry({
        adapter: new InMemoryDomainAdapter({}),
        models: {
          book: {
            attributes: {
              published_on: {
                type: 'datetime',
                label: 'Publication Date',
                description: 'Date published'
              }
            }
          }
        }
      })
      const context = await registry2.getContextForModel('book')
      const attr = context.attributes?.find((a) => a.name === 'published_on')
      expect(attr?.label).toBe('Publication Date')
    })

    it('should mark immutable attributes correctly', async () => {
      const registry2 = new DomainRegistry({
        adapter: new InMemoryDomainAdapter({}),
        models: {
          book: {
            attributes: {
              isbn: { type: 'string', immutable: true, description: 'ISBN' },
              title: { type: 'string', description: 'Title' }
            }
          }
        }
      })
      const context = await registry2.getContextForModel('book')
      const isbn = context.attributes?.find((a) => a.name === 'isbn')
      const title = context.attributes?.find((a) => a.name === 'title')
      expect(isbn?.immutable).toBe(true)
      expect(title?.immutable).toBe(false)
    })

    it('should mark required attributes correctly', async () => {
      const registry2 = new DomainRegistry({
        adapter: new InMemoryDomainAdapter({}),
        models: {
          book: {
            attributes: {
              title: { type: 'string', required: true, description: 'Title' },
              subtitle: { type: 'string', description: 'Subtitle' }
            }
          }
        }
      })
      const context = await registry2.getContextForModel('book')
      const title = context.attributes?.find((a) => a.name === 'title')
      const subtitle = context.attributes?.find((a) => a.name === 'subtitle')
      expect(title?.required).toBe(true)
      expect(subtitle?.required).toBe(false)
    })

    it('should include readOnly flag from model api config', async () => {
      const registry2 = new DomainRegistry({
        adapter: new InMemoryDomainAdapter({}),
        models: {
          genre: { api: { readOnly: true }, attributes: {} }
        }
      })
      const context = await registry2.getContextForModel('genre')
      expect(context.readOnly).toBe(true)
    })

    it('should include associations from model class', async () => {
      const registry2 = new DomainRegistry({
        adapter: new InMemoryDomainAdapter({}),
        models: {
          book: {
            attributes: {},
            associations: { belongsTo: { author: { foreignKey: 'author_id' } } }
          }
        }
      })
      const context = await registry2.getContextForModel('book')
      expect(context.associations).toBeDefined()
      expect((context.associations as Record<string, unknown>).belongsTo).toBeDefined()
    })

    it('should not include field-level metadata when model not in registry', async () => {
      const context = await registry.getContextForModel('model_z')
      expect(context.description).toBeUndefined()
      expect(context.attributes).toBeUndefined()
      expect(context.readOnly).toBeUndefined()
    })
  })

  describe('getConcept', () => {
    it('should return concept by name', async () => {
      expect(await registry.getConcept('test_concept')).toBeDefined()
    })

    it('should return undefined for unknown name', async () => {
      expect(await registry.getConcept('nonexistent')).toBeUndefined()
    })
  })

  describe('getAllConcepts', () => {
    it('should return all concepts', async () => {
      const all = await registry.getAllConcepts()
      expect(all).toHaveLength(1)
      expect(all[0].name).toBe('test_concept')
    })

    it('should return empty array when no concepts', async () => {
      const emptyRegistry = new DomainRegistry({ adapter: new InMemoryDomainAdapter({}) })
      expect(await emptyRegistry.getAllConcepts()).toEqual([])
    })
  })

  describe('getConceptsForModel', () => {
    it('should return concepts for a specific model', async () => {
      const concepts = await registry.getConceptsForModel('model_a')
      expect(concepts).toHaveLength(1)
      expect(concepts[0].name).toBe('test_concept')
    })

    it('should return concepts that span multiple models', async () => {
      const conceptsB = await registry.getConceptsForModel('model_b')
      expect(conceptsB).toHaveLength(1)
    })

    it('should return empty array for model with no concepts', async () => {
      const concepts = await registry.getConceptsForModel('unknown')
      expect(concepts).toEqual([])
    })
  })

  describe('searchConcepts', () => {
    it('should search concepts', async () => {
      expect(await registry.searchConcepts('test')).toHaveLength(1)
    })
  })

  describe('checkRules', () => {
    it('should evaluate rules and return results', async () => {
      const result = await registry.checkRules('model_a', { value: 5 })
      expect(result.passed).toBe(true)
    })

    it('should detect violations', async () => {
      const result = await registry.checkRules('model_a', { value: -1 })
      expect(result.passed).toBe(false)
    })
  })

  describe('describeRules', () => {
    it('should describe rules for model', async () => {
      const rules = await registry.describeRules('model_a')
      expect(rules).toHaveLength(1)
      expect(rules[0].name).toBe('positive_value')
    })
  })

  describe('workflows', () => {
    it('should suggest workflows by goal', async () => {
      expect(await registry.suggestWorkflow('create')).toHaveLength(1)
    })

    it('should get workflow by name', async () => {
      expect(await registry.getWorkflow('create_a')).toBeDefined()
    })

    it('should return undefined for unknown workflow name', async () => {
      expect(await registry.getWorkflow('nonexistent')).toBeUndefined()
    })

    it('should get all workflows', async () => {
      const all = await registry.getAllWorkflows()
      expect(all).toHaveLength(1)
      expect(all[0].name).toBe('create_a')
    })

    it('getAllWorkflows returns empty array when none registered', async () => {
      const emptyRegistry = new DomainRegistry({ adapter: new InMemoryDomainAdapter({}) })
      expect(await emptyRegistry.getAllWorkflows()).toEqual([])
    })

    it('should get workflows by tag', async () => {
      expect(await registry.getWorkflowsByTag('onboarding')).toHaveLength(1)
    })

    it('should return empty array for unknown tag', async () => {
      expect(await registry.getWorkflowsByTag('missing')).toEqual([])
    })
  })
})
