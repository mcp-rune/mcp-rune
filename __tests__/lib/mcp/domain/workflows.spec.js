import {
  WorkflowStep,
  WorkflowDefinition,
  WorkflowRegistry
} from '../../../../lib/mcp/domain/workflows.js'

describe('lib/mcp/domain/workflows', () => {
  describe('WorkflowStep', () => {
    it('should store step properties', () => {
      const step = new WorkflowStep({
        order: 1,
        title: 'Find title',
        description: 'Search for the title',
        tool: 'find_model',
        toolArgs: { model: 'title' },
        tips: ['Use name search']
      })
      expect(step.order).toBe(1)
      expect(step.title).toBe('Find title')
      expect(step.tool).toBe('find_model')
      expect(step.toolArgs.model).toBe('title')
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
          name: 'setup_vod',
          title: 'Set Up VOD',
          description: 'Set up VOD availability for content',
          tags: ['vod', 'onboarding'],
          models: ['rule', 'scheduling'],
          steps: [{ order: 1, title: 'Find', description: 'Find title' }]
        }),
        new WorkflowDefinition({
          name: 'demo_vod',
          title: 'Demo VOD',
          description: 'Demo VOD rules for customers',
          tags: ['vod', 'demo'],
          models: ['rule'],
          steps: [{ order: 1, title: 'Intro', description: 'Introduce VOD' }]
        }),
        new WorkflowDefinition({
          name: 'create_deal',
          title: 'Create a Deal',
          description: 'Create a licensing deal with rights',
          tags: ['licensing'],
          models: ['deal', 'right'],
          steps: [{ order: 1, title: 'Find licensor', description: 'Find the licensor' }]
        })
      ])
    })

    it('should get workflow by name', () => {
      const w = registry.getWorkflow('setup_vod')
      expect(w).toBeDefined()
      expect(w.title).toBe('Set Up VOD')
    })

    it('should return undefined for unknown workflow', () => {
      expect(registry.getWorkflow('unknown')).toBeUndefined()
    })

    it('should get all workflows', () => {
      expect(registry.getAllWorkflows()).toHaveLength(3)
    })

    it('should search workflows by query', async () => {
      expect(await registry.searchWorkflows('VOD')).toHaveLength(2)
      expect(await registry.searchWorkflows('deal')).toHaveLength(1)
      expect(await registry.searchWorkflows('licensing')).toHaveLength(1)
    })

    it('should get workflows by tag', () => {
      expect(registry.getWorkflowsByTag('vod')).toHaveLength(2)
      expect(registry.getWorkflowsByTag('demo')).toHaveLength(1)
      expect(registry.getWorkflowsByTag('onboarding')).toHaveLength(1)
    })

    it('should get workflows by model', () => {
      expect(registry.getWorkflowsByModel('rule')).toHaveLength(2)
      expect(registry.getWorkflowsByModel('deal')).toHaveLength(1)
      expect(registry.getWorkflowsByModel('unknown')).toHaveLength(0)
    })
  })
})
