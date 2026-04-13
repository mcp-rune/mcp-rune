import { SuggestWorkflowTool } from '../../../../../lib/mcp/tools/domain/suggest-workflow-tool.js'
import { DomainRegistry } from '../../../../../lib/mcp/domain/registry.js'
import { DomainKnowledge } from '../../../../../lib/mcp/domain/knowledge.js'
import { RuleSet } from '../../../../../lib/mcp/domain/business-rules.js'
import { WorkflowRegistry, WorkflowDefinition } from '../../../../../lib/mcp/domain/workflows.js'
import { TOOL_CATEGORIES } from '../../../../../lib/mcp/tools/categories.js'

function createTestRegistry() {
  return new DomainRegistry({
    knowledge: new DomainKnowledge({ concepts: [], models: {} }),
    rules: new RuleSet([]),
    workflows: new WorkflowRegistry([
      new WorkflowDefinition({
        name: 'setup_vod',
        title: 'Set Up VOD',
        description: 'Set up VOD availability',
        tags: ['vod', 'onboarding'],
        models: ['rule'],
        steps: [
          {
            order: 1,
            title: 'Find title',
            description: 'Search for the title',
            tool: 'find_model'
          },
          { order: 2, title: 'Create rule', description: 'Create the rule', tool: 'create_model' }
        ]
      }),
      new WorkflowDefinition({
        name: 'demo_vod',
        title: 'Demo VOD',
        description: 'Demo VOD rules',
        tags: ['vod', 'demo'],
        models: ['rule'],
        steps: [{ order: 1, title: 'Intro', description: 'Introduce VOD' }]
      }),
      new WorkflowDefinition({
        name: 'create_deal',
        title: 'Create a Deal',
        description: 'Create a licensing deal',
        tags: ['licensing'],
        models: ['deal'],
        steps: [{ order: 1, title: 'Find licensor', description: 'Search' }]
      })
    ])
  })
}

describe('SuggestWorkflowTool', () => {
  let tool

  beforeEach(() => {
    tool = new SuggestWorkflowTool({ domainRegistry: createTestRegistry() })
  })

  it('should have correct name and category', () => {
    expect(tool.name).toBe('suggest_workflow')
    expect(SuggestWorkflowTool.category).toBe(TOOL_CATEGORIES.DOMAIN)
    expect(SuggestWorkflowTool.requiresAuth).toBe(false)
  })

  it('should list all workflows when no params', async () => {
    const result = await tool.execute({})
    const text = result.content[0].text
    expect(text).toContain('Available Workflows')
    expect(text).toContain('Set Up VOD')
    expect(text).toContain('Demo VOD')
    expect(text).toContain('Create a Deal')
  })

  it('should render roadmap + first step only', async () => {
    const result = await tool.execute({ workflow: 'setup_vod' })
    const text = result.content[0].text
    // Overview
    expect(text).toContain('Set Up VOD')
    // Roadmap has both steps as titles (no descriptions)
    expect(text).toContain('Roadmap')
    expect(text).toContain('1. Find title')
    expect(text).toContain('2. Create rule')
    // Step 1 rendered in detail
    expect(text).toContain('Step 1: Find title')
    expect(text).toContain('find_model')
    // Step 2 NOT rendered in detail (only in roadmap)
    expect(text).not.toContain('Step 2: Create rule')
    // Mandatory chaining instruction
    expect(text).toContain('Execute ONLY the step shown below')
    expect(text).toContain('MUST call `get_workflow_step`')
    // Next step hint
    expect(text).toContain('get_workflow_step')
    expect(text).toContain('step: 2')
  })

  it('should handle unknown workflow name', async () => {
    const result = await tool.execute({ workflow: 'unknown' })
    const text = result.content[0].text
    expect(text).toContain('not found')
    expect(text).toContain('setup_vod')
  })

  it('should filter by tag', async () => {
    const result = await tool.execute({ tag: 'demo' })
    const text = result.content[0].text
    expect(text).toContain('Demo VOD')
    expect(text).not.toContain('Create a Deal')
  })

  it('should return single workflow when tag matches one', async () => {
    const result = await tool.execute({ tag: 'licensing' })
    const text = result.content[0].text
    expect(text).toContain('Create a Deal')
    expect(text).toContain('Step 1')
  })

  it('should search by goal', async () => {
    const result = await tool.execute({ goal: 'VOD' })
    const text = result.content[0].text
    expect(text).toContain('Set Up VOD')
    expect(text).toContain('Demo VOD')
  })

  it('should return single workflow when goal matches one', async () => {
    const result = await tool.execute({ goal: 'licensing deal' })
    const text = result.content[0].text
    expect(text).toContain('Create a Deal')
    expect(text).toContain('Step 1')
  })

  it('should handle no results for goal', async () => {
    const result = await tool.execute({ goal: 'nonexistent_xyz' })
    const text = result.content[0].text
    expect(text).toContain('No workflows found')
    expect(text).toContain('Available workflows')
  })

  it('should throw without domain registry', async () => {
    const toolNoRegistry = new SuggestWorkflowTool({})
    await expect(toolNoRegistry.execute({ goal: 'test' })).rejects.toThrow('No domain registry')
  })

  it('should use dynamic exclusion with appToolNames', async () => {
    const toolWithApps = new SuggestWorkflowTool({
      domainRegistry: createTestRegistry(),
      serverContext: {
        appToolNames: ['search_records_view', 'list_records_view', 'view_records']
      }
    })
    const result = await toolWithApps.execute({ workflow: 'setup_vod' })
    const text = result.content[0].text
    // Should include actual app tool names in exclusion
    expect(text).toContain('search_records_view')
    expect(text).toContain('list_records_view')
    expect(text).toContain('view_records')
    // Should NOT include the old hardcoded name
    expect(text).not.toContain('record_detail_view')
  })

  it('should render loop group when first step is in a loop', async () => {
    const registry = new DomainRegistry({
      knowledge: new DomainKnowledge({ concepts: [], models: {} }),
      rules: new RuleSet([]),
      workflows: new WorkflowRegistry([
        new WorkflowDefinition({
          name: 'loop_first',
          title: 'Loop First',
          description: 'Workflow starting with a loop',
          steps: [
            {
              order: 1,
              title: 'Fetch',
              description: 'Fetch data',
              tool: 'search_records',
              exhaustive: true,
              loopGroup: 'fetch-loop'
            },
            {
              order: 2,
              title: 'Process',
              description: 'Process page',
              tool: 'store_analysis_memory',
              loopGroup: 'fetch-loop'
            },
            { order: 3, title: 'Done', description: 'Finish up' }
          ]
        })
      ])
    })
    const loopTool = new SuggestWorkflowTool({ domainRegistry: registry })
    const result = await loopTool.execute({ workflow: 'loop_first' })
    const text = result.content[0].text
    expect(text).toContain('Steps 1–2')
    expect(text).toContain('loop')
    expect(text).toContain('Step 1: Fetch')
    expect(text).toContain('Step 2: Process')
    expect(text).toContain('Exhaustive fetch')
  })

  it('should render parallel group when first step is parallel', async () => {
    const registry = new DomainRegistry({
      knowledge: new DomainKnowledge({ concepts: [], models: {} }),
      rules: new RuleSet([]),
      workflows: new WorkflowRegistry([
        new WorkflowDefinition({
          name: 'parallel_first',
          title: 'Parallel First',
          description: 'Workflow starting with parallel steps',
          steps: [
            {
              order: 1,
              title: 'Fetch A',
              description: 'Get A',
              tool: 'find_model',
              parallelGroup: 'init'
            },
            {
              order: 2,
              title: 'Fetch B',
              description: 'Get B',
              tool: 'list_models',
              parallelGroup: 'init'
            },
            { order: 3, title: 'Done', description: 'Finish up' }
          ]
        })
      ])
    })
    const parallelTool = new SuggestWorkflowTool({ domainRegistry: registry })
    const result = await parallelTool.execute({ workflow: 'parallel_first' })
    const text = result.content[0].text
    expect(text).toContain('Steps 1–2')
    expect(text).toContain('parallel')
    expect(text).toContain('Step 1: Fetch A')
    expect(text).toContain('Step 2: Fetch B')
    expect(text).toContain('step: 3')
  })
})
