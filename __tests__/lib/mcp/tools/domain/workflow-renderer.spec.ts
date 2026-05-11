import { WorkflowDefinition } from '../../../../../src/mcp/domain/workflows.js'
import {
  collectStepGroup,
  findNextStepOrder,
  findStepInfo,
  renderLoopGroup,
  renderNextStepHint,
  renderPaginationGuidance,
  renderParallelGroup,
  renderRoadmap,
  renderStepDetail,
  renderToolGuidance,
  renderWorkflowList,
  renderWorkflowOverview
} from '../../../../../src/mcp/tools/domain/workflow-renderer.js'

const APP_TOOL_NAMES = ['search_records_app', 'list_records_app', 'find_records_app']

function createWorkflow(overrides = {}) {
  return new WorkflowDefinition({
    name: 'test_workflow',
    title: 'Test Workflow',
    description: 'A test workflow',
    tags: ['test'],
    models: ['activity'],
    steps: [
      { order: 1, title: 'Step one', description: 'First step', tool: 'find_records' },
      {
        order: 2,
        title: 'Search',
        description: 'Fetch data',
        tool: 'search_records',
        exhaustive: true,
        loopGroup: 'fetch-loop'
      },
      {
        order: 3,
        title: 'Analyze',
        description: 'Process data',
        tool: 'store_analysis_memory',
        loopGroup: 'fetch-loop'
      },
      { order: 4, title: 'Final', description: 'Last step', tool: 'create_model' }
    ],
    ...overrides
  })
}

describe('workflow-renderer', () => {
  // ─── renderToolGuidance ─────────────────────────────────────────────────

  describe('renderToolGuidance', () => {
    it('should list app tool names for data tools', () => {
      const step = { tool: 'search_records' }
      const result = renderToolGuidance(step, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('search_records_app')
      expect(result).toContain('list_records_app')
      expect(result).toContain('find_records_app')
      expect(result).toContain('visual/interactive tool')
    })

    it('should use simpler warning for non-data tools', () => {
      const step = { tool: 'bulk_action_models' }
      const result = renderToolGuidance(step, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('Do NOT substitute with any other tool')
      expect(result).not.toContain('search_records_app')
    })

    it('should return empty for app tools', () => {
      const step = { tool: 'search_records_app' }
      const result = renderToolGuidance(step, { appToolNames: APP_TOOL_NAMES })
      expect(result).toBe('')
    })

    it('should return empty when no tool', () => {
      const result = renderToolGuidance({}, { appToolNames: APP_TOOL_NAMES })
      expect(result).toBe('')
    })

    it('should handle empty appToolNames', () => {
      const step = { tool: 'find_records' }
      const result = renderToolGuidance(step, { appToolNames: [] })
      expect(result).toContain('Do NOT substitute with any visual/interactive tool')
    })
  })

  // ─── renderPaginationGuidance ───────────────────────────────────────────

  describe('renderPaginationGuidance', () => {
    it('should reference the specific tool name', () => {
      const result = renderPaginationGuidance({ tool: 'search_records' })
      expect(result).toContain('search_records')
      expect(result).toContain('pagination.total_pages')
      expect(result).toContain('page: 2, 3')
    })
  })

  // ─── renderStepDetail ──────────────────────────────────────────────────

  describe('renderStepDetail', () => {
    it('should render step title and description', () => {
      const step = { order: 1, title: 'Test', description: 'A test', tips: [] }
      const result = renderStepDetail(step)
      expect(result).toContain('Step 1: Test')
      expect(result).toContain('A test')
    })

    it('should render tool with exclusion guidance', () => {
      const step = {
        order: 1,
        title: 'Test',
        description: 'A test',
        tool: 'find_records',
        tips: []
      }
      const result = renderStepDetail(step, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('**Tool:** `find_records`')
      expect(result).toContain('search_records_app')
    })

    it('should render exhaustive guidance', () => {
      const step = {
        order: 2,
        title: 'Fetch',
        description: 'Fetch all',
        tool: 'search_records',
        exhaustive: true,
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).toContain('Exhaustive fetch')
      expect(result).toContain('pagination.total_pages')
    })

    it('should not render exhaustive guidance when false', () => {
      const step = {
        order: 1,
        title: 'Single',
        description: 'One',
        tool: 'find_records',
        exhaustive: false,
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).not.toContain('Exhaustive fetch')
    })

    it('should render tips', () => {
      const step = { order: 1, title: 'T', description: 'D', tips: ['Tip one', 'Tip two'] }
      const result = renderStepDetail(step)
      expect(result).toContain('- Tip one')
      expect(result).toContain('- Tip two')
    })

    it('should render optional steps', () => {
      const step = {
        order: 1,
        title: 'T',
        description: 'D',
        tool: 'store_analysis_memory',
        optional: true,
        fallbackDescription: 'Do it manually',
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).toContain('Optional step')
      expect(result).toContain('Do it manually')
    })

    it('should render changeset metadata', () => {
      const step = {
        order: 1,
        title: 'T',
        description: 'D',
        tool: 'bulk_action_models',
        changeset: { mutating: true },
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).toContain('plan_id')
      expect(result).toContain('Mutating')
    })

    it('should render dependsOn', () => {
      const step = {
        order: 3,
        title: 'T',
        description: 'D',
        dependsOn: [1, 2],
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).toContain('Depends on')
      expect(result).toContain('Step 1')
      expect(result).toContain('Step 2')
    })

    it('should render requiresPlan changeset', () => {
      const step = {
        order: 6,
        title: 'Preview',
        description: 'Show preview',
        tool: 'preview_mutation_plan',
        changeset: { requiresPlan: 'reclassification-plan' },
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).toContain('REQUIRED')
      expect(result).toContain('preview_mutation_plan')
    })

    it('should render tool args as JSON', () => {
      const step = {
        order: 1,
        title: 'T',
        description: 'D',
        tool: 'find_records',
        toolArgs: { model: 'book', id: '123' },
        tips: []
      }
      const result = renderStepDetail(step)
      expect(result).toContain('"model": "book"')
      expect(result).toContain('"id": "123"')
    })
  })

  // ─── renderLoopGroup ──────────────────────────────────────────────────

  describe('renderLoopGroup', () => {
    it('should render loop header with all steps', () => {
      const w = createWorkflow()
      const steps = w.steps.filter((s) => s.loopGroup === 'fetch-loop')
      const result = renderLoopGroup(steps, w, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('Steps 2–3')
      expect(result).toContain('loop')
      expect(result).toContain('Step 2: Search')
      expect(result).toContain('Step 3: Analyze')
      expect(result).toContain('step: 4')
    })

    it('should include pagination guidance for exhaustive step in loop', () => {
      const w = createWorkflow()
      const steps = w.steps.filter((s) => s.loopGroup === 'fetch-loop')
      const result = renderLoopGroup(steps, w, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('Exhaustive fetch')
    })

    it('should show workflow complete when loop is the last step group', () => {
      const w = createWorkflow({
        steps: [
          { order: 1, title: 'Intro', description: 'Start', tool: 'find_records' },
          {
            order: 2,
            title: 'Fetch',
            description: 'Fetch data',
            tool: 'search_records',
            exhaustive: true,
            loopGroup: 'final-loop'
          },
          {
            order: 3,
            title: 'Process',
            description: 'Process data',
            tool: 'store_analysis_memory',
            loopGroup: 'final-loop'
          }
        ]
      })
      const steps = w.steps.filter((s) => s.loopGroup === 'final-loop')
      const result = renderLoopGroup(steps, w, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('workflow is complete')
    })
  })

  // ─── renderParallelGroup ──────────────────────────────────────────────

  describe('renderParallelGroup', () => {
    it('should render parallel header with all steps', () => {
      const steps = [
        { order: 1, title: 'A', description: 'Do A', tool: 'find_records', tips: [] },
        { order: 2, title: 'B', description: 'Do B', tool: 'list_models', tips: [] }
      ]
      const result = renderParallelGroup(steps, { appToolNames: APP_TOOL_NAMES })
      expect(result).toContain('Steps 1–2')
      expect(result).toContain('parallel')
      expect(result).toContain('Step 1: A')
      expect(result).toContain('Step 2: B')
    })
  })

  // ─── renderWorkflowOverview ───────────────────────────────────────────

  describe('renderWorkflowOverview', () => {
    it('should render title, description, tags, models', () => {
      const w = createWorkflow()
      const result = renderWorkflowOverview(w)
      expect(result).toContain('# Test Workflow')
      expect(result).toContain('A test workflow')
      expect(result).toContain('test')
      expect(result).toContain('activity')
    })

    it('should render draft required', () => {
      const w = createWorkflow({ draftRequired: true })
      const result = renderWorkflowOverview(w)
      expect(result).toContain('Draft Required')
    })
  })

  // ─── renderRoadmap ────────────────────────────────────────────────────

  describe('renderRoadmap', () => {
    it('should list all steps with titles only (no descriptions)', () => {
      const w = createWorkflow()
      const result = renderRoadmap(w)
      expect(result).toContain('Roadmap')
      expect(result).toContain('1. Step one')
      expect(result).toContain('2. Search')
      expect(result).toContain('3. Analyze')
      expect(result).toContain('4. Final')
      // Should NOT include step descriptions
      expect(result).not.toContain('First step')
      expect(result).not.toContain('Fetch data')
      expect(result).not.toContain('Process data')
      expect(result).not.toContain('Last step')
    })

    it('should annotate loop steps', () => {
      const w = createWorkflow()
      const result = renderRoadmap(w)
      expect(result).toContain('*(loop)*')
    })
  })

  // ─── renderNextStepHint ───────────────────────────────────────────────

  describe('renderNextStepHint', () => {
    it('should point to next step', () => {
      const w = createWorkflow()
      const result = renderNextStepHint(w, 1)
      expect(result).toContain('step: 2')
    })

    it('should skip over loop group to next step after group', () => {
      const w = createWorkflow()
      const result = renderNextStepHint(w, 2)
      expect(result).toContain('step: 4')
    })

    it('should show workflow complete for last step', () => {
      const w = createWorkflow()
      const result = renderNextStepHint(w, 4)
      expect(result).toContain('Workflow complete')
    })
  })

  // ─── findStepInfo ─────────────────────────────────────────────────────

  describe('findStepInfo', () => {
    it('should find regular step', () => {
      const w = createWorkflow()
      const info = findStepInfo(w, 1)
      expect(info.groupType).toBeNull()
      expect(info.group).toHaveLength(1)
      expect(info.step.order).toBe(1)
    })

    it('should find loop group from any member', () => {
      const w = createWorkflow()
      const info2 = findStepInfo(w, 2)
      expect(info2.groupType).toBe('loop')
      expect(info2.group).toHaveLength(2)

      const info3 = findStepInfo(w, 3)
      expect(info3.groupType).toBe('loop')
      expect(info3.group).toHaveLength(2)
    })

    it('should find parallel group from any member', () => {
      const w = createWorkflow({
        steps: [
          { order: 1, title: 'A', description: 'A', tool: 'find_records', parallelGroup: 'p1' },
          { order: 2, title: 'B', description: 'B', tool: 'list_models', parallelGroup: 'p1' },
          { order: 3, title: 'C', description: 'C', tool: 'create_model' }
        ]
      })
      const info1 = findStepInfo(w, 1)
      expect(info1.groupType).toBe('parallel')
      expect(info1.group).toHaveLength(2)

      const info2 = findStepInfo(w, 2)
      expect(info2.groupType).toBe('parallel')
      expect(info2.group).toHaveLength(2)
    })

    it('should return null for missing step', () => {
      const w = createWorkflow()
      expect(findStepInfo(w, 99)).toBeNull()
    })
  })

  // ─── findNextStepOrder ────────────────────────────────────────────────

  describe('findNextStepOrder', () => {
    it('should return next step for regular step', () => {
      const w = createWorkflow()
      expect(findNextStepOrder(w, 1)).toBe(2)
    })

    it('should skip past loop group', () => {
      const w = createWorkflow()
      expect(findNextStepOrder(w, 2)).toBe(4)
      expect(findNextStepOrder(w, 3)).toBe(4)
    })

    it('should return null for last step', () => {
      const w = createWorkflow()
      expect(findNextStepOrder(w, 4)).toBeNull()
    })
  })

  // ─── collectStepGroup ─────────────────────────────────────────────────

  describe('collectStepGroup', () => {
    it('should collect adjacent steps with same group key', () => {
      const w = createWorkflow()
      const { group, endIndex } = collectStepGroup(w.steps, 1, 'loopGroup')
      expect(group).toHaveLength(2)
      expect(group[0].order).toBe(2)
      expect(group[1].order).toBe(3)
      expect(endIndex).toBe(3)
    })
  })

  // ─── renderWorkflowList ───────────────────────────────────────────────

  describe('renderWorkflowList', () => {
    it('should list workflows with names and tags', () => {
      const workflows = [
        createWorkflow(),
        createWorkflow({ name: 'other', title: 'Other', tags: ['demo'] })
      ]
      const result = renderWorkflowList(workflows, 'Results')
      expect(result).toContain('# Results')
      expect(result).toContain('Test Workflow')
      expect(result).toContain('Other')
      expect(result).toContain('[demo]')
    })
  })
})
