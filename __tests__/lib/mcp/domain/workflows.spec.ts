import {
  WorkflowDefinition,
  WorkflowRegistry,
  WorkflowStep
} from '../../../../src/mcp/domain/workflows.js'

describe('lib/mcp/domain/workflows', () => {
  describe('WorkflowStep', () => {
    it('should store step properties', () => {
      const step = new WorkflowStep({
        order: 1,
        title: 'Find book',
        description: 'Search for the book',
        tool: 'find_records',
        toolArgs: { model: 'book' },
        tips: ['Use name search']
      })
      expect(step.order).toBe(1)
      expect(step.title).toBe('Find book')
      expect(step.tool).toBe('find_records')
      expect(step.toolArgs.model).toBe('book')
      expect(step.tips).toHaveLength(1)
    })

    it('should default tips to empty array', () => {
      const step = new WorkflowStep({
        order: 1,
        title: 'Step',
        description: 'Desc'
      })
      expect(step.tips).toEqual([])
    })

    it('should default exhaustive to false and loopGroup to null', () => {
      const step = new WorkflowStep({
        order: 1,
        title: 'Step',
        description: 'Desc'
      })
      expect(step.exhaustive).toBe(false)
      expect(step.loopGroup).toBeNull()
    })

    it('should store exhaustive and loopGroup', () => {
      const step = new WorkflowStep({
        order: 2,
        title: 'Search',
        description: 'Fetch data',
        tool: 'search_records',
        exhaustive: true,
        loopGroup: 'fetch-analyze'
      })
      expect(step.exhaustive).toBe(true)
      expect(step.loopGroup).toBe('fetch-analyze')
    })

    it('should support decision points', () => {
      const step = new WorkflowStep({
        order: 2,
        title: 'Decide',
        description: 'Make a choice',
        decision: {
          question: 'All platforms?',
          options: [
            { label: 'All', description: 'Apply to all' },
            { label: 'Specific', description: 'Choose platforms' }
          ]
        }
      })
      expect(step.decision.question).toBe('All platforms?')
      expect(step.decision.options).toHaveLength(2)
    })
  })

  describe('WorkflowDefinition', () => {
    it('should create workflow with steps', () => {
      const workflow = new WorkflowDefinition({
        name: 'test_workflow',
        title: 'Test Workflow',
        description: 'A test workflow',
        tags: ['test'],
        models: ['model_a'],
        steps: [
          { order: 1, title: 'Step 1', description: 'First step' },
          { order: 2, title: 'Step 2', description: 'Second step' }
        ]
      })
      expect(workflow.name).toBe('test_workflow')
      expect(workflow.steps).toHaveLength(2)
      expect(workflow.steps[0]).toBeInstanceOf(WorkflowStep)
    })

    it('should accept WorkflowStep instances directly', () => {
      const step = new WorkflowStep({ order: 1, title: 'S', description: 'D' })
      const workflow = new WorkflowDefinition({
        name: 'w',
        title: 'W',
        description: 'D',
        steps: [step]
      })
      expect(workflow.steps[0]).toBe(step)
    })

    it('should default tags and models', () => {
      const workflow = new WorkflowDefinition({
        name: 'w',
        title: 'W',
        description: 'D'
      })
      expect(workflow.tags).toEqual([])
      expect(workflow.models).toEqual([])
      expect(workflow.steps).toEqual([])
    })
  })

  describe('WorkflowRegistry', () => {
    let registry

    beforeEach(() => {
      registry = new WorkflowRegistry([
        new WorkflowDefinition({
          name: 'create_project',
          title: 'Create a Project',
          description: 'Set up a new project with tasks',
          tags: ['project', 'onboarding', 'guide'],
          models: ['project', 'task'],
          steps: [{ order: 1, title: 'Find', description: 'Find or create project' }]
        }),
        new WorkflowDefinition({
          name: 'demo_library',
          title: 'Demo Library',
          description: 'Demo the library and book catalog for users',
          tags: ['library', 'demo', 'guide'],
          models: ['book'],
          steps: [{ order: 1, title: 'Intro', description: 'Introduce the library' }]
        }),
        new WorkflowDefinition({
          name: 'track_reading',
          title: 'Track Reading Progress',
          description: 'Track reading progress and book catalog',
          tags: ['reading', 'catalog'],
          models: ['book', 'author'],
          steps: [{ order: 1, title: 'Find book', description: 'Find the book' }]
        })
      ])
    })

    it('should get workflow by name', () => {
      const w = registry.getWorkflow('create_project')
      expect(w).toBeDefined()
      expect(w.title).toBe('Create a Project')
    })

    it('should return undefined for unknown workflow', () => {
      expect(registry.getWorkflow('unknown')).toBeUndefined()
    })

    it('should get all workflows', () => {
      expect(registry.getAllWorkflows()).toHaveLength(3)
    })

    it('should search workflows by query', async () => {
      expect(await registry.searchWorkflows('book')).toHaveLength(2)
      expect(await registry.searchWorkflows('project')).toHaveLength(1)
      expect(await registry.searchWorkflows('reading')).toHaveLength(1)
    })

    it('should get workflows by tag', () => {
      expect(registry.getWorkflowsByTag('guide')).toHaveLength(2)
      expect(registry.getWorkflowsByTag('demo')).toHaveLength(1)
      expect(registry.getWorkflowsByTag('onboarding')).toHaveLength(1)
    })

    it('should get workflows by model', () => {
      expect(registry.getWorkflowsByModel('book')).toHaveLength(2)
      expect(registry.getWorkflowsByModel('project')).toHaveLength(1)
      expect(registry.getWorkflowsByModel('unknown')).toHaveLength(0)
    })
  })
})
