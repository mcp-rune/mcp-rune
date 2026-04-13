import { DomainConcept, DomainKnowledge } from '../../../../lib/mcp/domain/knowledge.js'

describe('lib/mcp/domain/knowledge', () => {
  const testConcepts = [
    new DomainConcept({
      name: 'hierarchy',
      title: 'Entity Hierarchy',
      description: 'Parent-child relationships between entities.',
      models: ['parent', 'child'],
      tags: ['structure', 'relationships'],
      details: {
        inheritance: { from: 'parent', to: 'child', fields: ['field_a'] },
        process: 'Create parent first, then child',
        tips: ['Tip one', 'Tip two']
      }
    }),
    new DomainConcept({
      name: 'validation_flow',
      title: 'Validation Flow',
      description: 'How validation works across entities.',
      models: ['child', 'other'],
      tags: ['validation']
    })
  ]

  const testModels = {
    parent: {
      description: 'Parent entity',
      attributes: {
        id: { type: 'string', description: 'ID' },
        name: { type: 'string', required: true, description: 'Name' }
      },
      associations: { hasMany: { children: {} } }
    },
    child: {
      description: 'Child entity',
      attributes: {
        id: { type: 'string', description: 'ID' }
      },
      associations: {}
    }
  }

  describe('DomainConcept', () => {
    it('should store concept properties', () => {
      const concept = testConcepts[0]
      expect(concept.name).toBe('hierarchy')
      expect(concept.title).toBe('Entity Hierarchy')
      expect(concept.models).toEqual(['parent', 'child'])
      expect(concept.tags).toEqual(['structure', 'relationships'])
      expect(concept.details.inheritance.from).toBe('parent')
    })

    it('should default tags and details', () => {
      const concept = new DomainConcept({
        name: 'minimal',
        title: 'Minimal',
        description: 'Minimal concept.',
        models: ['model_a']
      })
      expect(concept.tags).toEqual([])
      expect(concept.details).toEqual({})
    })
  })

  describe('DomainKnowledge', () => {
    let knowledge

    beforeEach(() => {
      knowledge = new DomainKnowledge({ concepts: testConcepts, models: testModels })
    })

    it('should get concept by name', () => {
      const concept = knowledge.getConcept('hierarchy')
      expect(concept).toBeDefined()
      expect(concept.title).toBe('Entity Hierarchy')
    })

    it('should return undefined for unknown concept', () => {
      expect(knowledge.getConcept('unknown')).toBeUndefined()
    })

    it('should get all concepts', () => {
      expect(knowledge.getAllConcepts()).toHaveLength(2)
    })

    it('should search concepts by name', async () => {
      const results = await knowledge.searchConcepts('hierarchy')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('hierarchy')
    })

    it('should search concepts by description', async () => {
      const results = await knowledge.searchConcepts('validation')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('validation_flow')
    })

    it('should search concepts by tag', async () => {
      const results = await knowledge.searchConcepts('structure')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('hierarchy')
    })

    it('should be case-insensitive in search', async () => {
      const results = await knowledge.searchConcepts('HIERARCHY')
      expect(results).toHaveLength(1)
    })

    it('should get concepts for model', () => {
      const results = knowledge.getConceptsForModel('child')
      expect(results).toHaveLength(2)
    })

    it('should get concepts by tag', () => {
      const results = knowledge.getConceptsByTag('validation')
      expect(results).toHaveLength(1)
    })

    it('should compose context for model with fields and concepts', () => {
      const context = knowledge.getContextForModel('parent')
      expect(context.model).toBe('parent')
      expect(context.description).toBe('Parent entity')
      expect(context.readOnly).toBe(false)
      expect(context.attributes).toHaveLength(2)
      expect(context.attributes[0].name).toBe('id')
      expect(context.attributes[0].immutable).toBe(false)
      expect(context.concepts).toHaveLength(1)
      expect(context.concepts[0].name).toBe('hierarchy')
    })

    it('should expose readOnly from model class', () => {
      const readOnlyModels = {
        ...testModels,
        readonly_model: {
          description: 'Read-only entity',
          api: { readOnly: true },
          attributes: { id: { type: 'string', description: 'ID' } }
        }
      }
      const k = new DomainKnowledge({ concepts: [], models: readOnlyModels })
      const context = k.getContextForModel('readonly_model')
      expect(context.readOnly).toBe(true)
    })

    it('should expose immutable from attribute config', () => {
      const modelsWithImmutable = {
        immutable_model: {
          description: 'Entity with immutable field',
          attributes: {
            id: { type: 'string', description: 'ID' },
            external_id: { type: 'string', immutable: true, description: 'External ID' }
          }
        }
      }
      const k = new DomainKnowledge({ concepts: [], models: modelsWithImmutable })
      const context = k.getContextForModel('immutable_model')
      expect(context.attributes[1].immutable).toBe(true)
    })

    it('should expose label from attribute config', () => {
      const modelsWithLabel = {
        labeled_model: {
          description: 'Entity with labeled field',
          attributes: {
            id: { type: 'string', description: 'ID' },
            started_at: { type: 'datetime', label: 'Start Time', description: 'When it started' }
          }
        }
      }
      const k = new DomainKnowledge({ concepts: [], models: modelsWithLabel })
      const context = k.getContextForModel('labeled_model')
      expect(context.attributes[1].label).toBe('Start Time')
      expect(context.attributes[0].label).toBeUndefined()
    })

    it('should compose context for model without model class', () => {
      const context = knowledge.getContextForModel('unknown')
      expect(context.model).toBe('unknown')
      expect(context.attributes).toBeUndefined()
      expect(context.concepts).toEqual([])
    })
  })
})
