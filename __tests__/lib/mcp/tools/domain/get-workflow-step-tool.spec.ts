import { RuleSet } from '../../../../../src/mcp/domain/business-rules.js'
import { DomainKnowledge } from '../../../../../src/mcp/domain/knowledge.js'
import { DomainRegistry } from '../../../../../src/mcp/domain/registry.js'
import { WorkflowDefinition, WorkflowRegistry } from '../../../../../src/mcp/domain/workflows.js'
import { TOOL_CATEGORIES } from '../../../../../src/mcp/tools/categories.js'
import { GetWorkflowStepTool } from '../../../../../src/mcp/tools/domain/get-workflow-step-tool.js'

function createTestRegistry() {
  return new DomainRegistry({
    knowledge: new DomainKnowledge({ concepts: [], models: {} }),
    rules: new RuleSet([]),
    workflows: new WorkflowRegistry([
      new WorkflowDefinition({
        name: 'multi_step',
        title: 'Multi Step Workflow',
        description: 'A workflow with various step types',
        tags: ['test'],
        models: ['activity'],
        steps: [
          {
            order: 1,
            title: 'List themes',
            description: 'Fetch all themes',
            tool: 'list_models',
            toolArgs: { model: 'theme' }
          },
          {
            order: 2,
            title: 'Search activities',
            description: 'Fetch activity data for analysis',
            tool: 'search_records',
            toolArgs: { model: 'activity' },
            exhaustive: true,
            loopGroup: 'fetch-analyze'
          },
          {
            order: 3,
            title: 'Store analysis',
            description: 'Store findings per page',
            tool: 'store_analysis_memory',
            loopGroup: 'fetch-analyze',
            optional: true,
            fallbackDescription: 'Keep in context'
          },
          {
            order: 4,
            title: 'Review results',
            description: 'Decide on scope',
            decision: {
              question: 'How to proceed?',
              options: [{ label: 'All', description: 'Apply all' }]
            }
          },
          {
            order: 5,
            title: 'Apply changes',
            description: 'Execute bulk update',
            tool: 'bulk_action_models',
            changeset: { mutating: true }
          }
        ]
      }),
      new WorkflowDefinition({
        name: 'parallel_workflow',
        title: 'Parallel Workflow',
        description: 'Workflow with parallel steps',
        steps: [
          {
            order: 1,
            title: 'Step A',
            description: 'Do A',
            tool: 'find_records',
            parallelGroup: 'p1'
          },
          {
            order: 2,
            title: 'Step B',
            description: 'Do B',
            tool: 'list_models',
            parallelGroup: 'p1'
          },
          { order: 3, title: 'Step C', description: 'Final step', tool: 'create_model' }
        ]
      })
    ])
  })
}

const APP_TOOL_NAMES = ['search_records_app', 'list_records_app', 'find_records_app']

describe('GetWorkflowStepTool', () => {
  let tool

  beforeEach(() => {
    tool = new GetWorkflowStepTool({
      domainRegistry: createTestRegistry(),
      serverContext: { appToolNames: APP_TOOL_NAMES }
    })
  })

  it('should have correct name and category', () => {
    expect(tool.name).toBe('get_workflow_step')
    expect(GetWorkflowStepTool.category).toBe(TOOL_CATEGORIES.DOMAIN)
    expect(GetWorkflowStepTool.requiresAuth).toBe(false)
  })

  // ─── Regular Steps ──────────────────────────────────────────────────────

  it('should render a regular step with tool and next hint', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 1 })
    const text = result.content[0].text
    expect(text).toContain('Step 1: List themes')
    expect(text).toContain('list_models')
    expect(text).toContain('get_workflow_step')
    expect(text).toContain('step: 2')
  })

  it('should render a decision step', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 4 })
    const text = result.content[0].text
    expect(text).toContain('Step 4: Review results')
    expect(text).toContain('How to proceed?')
    expect(text).toContain('step: 5')
  })

  it('should render the last step with workflow complete', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 5 })
    const text = result.content[0].text
    expect(text).toContain('Step 5: Apply changes')
    expect(text).toContain('Workflow complete')
  })

  // ─── Loop Groups ────────────────────────────────────────────────────────

  it('should render loop group when requesting any step in the group', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 2 })
    const text = result.content[0].text
    expect(text).toContain('Steps 2–3')
    expect(text).toContain('loop')
    expect(text).toContain('Step 2: Search activities')
    expect(text).toContain('Step 3: Store analysis')
    expect(text).toContain('search_records')
    expect(text).toContain('store_analysis_memory')
  })

  it('should render loop group when requesting step 3 (middle of group)', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 3 })
    const text = result.content[0].text
    // Should still render the whole group
    expect(text).toContain('Steps 2–3')
    expect(text).toContain('Step 2: Search activities')
    expect(text).toContain('Step 3: Store analysis')
  })

  it('should include exhaustive pagination guidance in loop', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 2 })
    const text = result.content[0].text
    expect(text).toContain('Exhaustive fetch')
    expect(text).toContain('pagination.total_pages')
  })

  it('should include next step hint after loop group', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 2 })
    const text = result.content[0].text
    expect(text).toContain('step: 4')
  })

  // ─── Parallel Groups ───────────────────────────────────────────────────

  it('should render parallel group', async () => {
    const result = await tool.execute({ workflow: 'parallel_workflow', step: 1 })
    const text = result.content[0].text
    expect(text).toContain('Steps 1–2')
    expect(text).toContain('parallel')
    expect(text).toContain('Step A')
    expect(text).toContain('Step B')
    expect(text).toContain('step: 3')
  })

  // ─── Dynamic Exclusion ─────────────────────────────────────────────────

  it('should include dynamic exclusion for data tools', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 1 })
    const text = result.content[0].text
    expect(text).toContain('search_records_app')
    expect(text).toContain('list_records_app')
    expect(text).toContain('find_records_app')
    expect(text).not.toContain('record_detail_view')
  })

  it('should use simpler exclusion for non-data tools', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 5 })
    const text = result.content[0].text
    // bulk_action_models is not a data tool — simpler warning
    expect(text).toContain('Do NOT substitute with any other tool')
    expect(text).not.toContain('search_records_app')
  })

  // ─── Error Handling ─────────────────────────────────────────────────────

  it('should handle unknown workflow', async () => {
    const result = await tool.execute({ workflow: 'nonexistent', step: 1 })
    const text = result.content[0].text
    expect(text).toContain('not found')
    expect(text).toContain('multi_step')
  })

  it('should handle out-of-range step', async () => {
    const result = await tool.execute({ workflow: 'multi_step', step: 99 })
    const text = result.content[0].text
    expect(text).toContain('Step 99 not found')
    expect(text).toContain('1, 2, 3, 4, 5')
  })

  it('should throw without domain registry', async () => {
    const toolNoRegistry = new GetWorkflowStepTool({})
    await expect(toolNoRegistry.execute({ workflow: 'test', step: 1 })).rejects.toThrow(
      'No domain registry'
    )
  })
})
