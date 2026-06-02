import { SelectionStore } from '../../../../src/mcp/apps/lib/selection-store.js'
import { createSelectionTools } from '../../../../src/mcp/apps/lib/selection-tools.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const resourceUri = 'app://search-model-app'
const modelNames = ['activity', 'contact', 'deal']
const getHtml = () => '<html></html>'

describe('createSelectionTools', () => {
  let tools, selectTool, getSelectionTool

  beforeEach(() => {
    tools = createSelectionTools('select_search_records', resourceUri, modelNames, { getHtml })
    selectTool = tools[0]
    getSelectionTool = tools[1]
  })

  it('returns array of 2 tools', () => {
    expect(tools).toHaveLength(2)
  })

  describe('select tool', () => {
    it('has correct toolName', () => {
      expect(selectTool.toolName).toBe('select_search_records')
    })

    it('has correct resourceUri', () => {
      expect(selectTool.resourceUri).toBe(resourceUri)
    })

    it('has visibility app-only', () => {
      expect(selectTool.visibility).toEqual(['app'])
    })

    it('does not need auth', () => {
      expect(selectTool.needsAuth).toBe(false)
    })

    it('has getHtml function', () => {
      expect(selectTool.getHtml).toBe(getHtml)
    })

    it('stores selection via selectionStore.set()', async () => {
      const selectionStore = new SelectionStore()
      const args = { model: 'activity', mode: 'ids', ids: ['1', '2'], total: 2 }

      const result = await selectTool.handleToolCall(args, { selectionStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.ok).toBe(true)
      expect(parsed.selection).toMatchObject({
        model: 'activity',
        mode: 'ids',
        ids: ['1', '2'],
        total: 2
      })
      expect(selectionStore.get('activity')).toBeDefined()
    })

    it('returns error when no selectionStore', async () => {
      const result = await selectTool.handleToolCall({ model: 'activity', mode: 'ids' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Selection store not available')
    })

    it('returns error when selectionStore is undefined in context', async () => {
      const result = await selectTool.handleToolCall({ model: 'activity', mode: 'ids' }, {})
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Selection store not available')
    })
  })

  describe('selection flow contract', () => {
    it('select tools are app-only (LLM cannot call)', () => {
      expect(selectTool.visibility).toEqual(['app'])
    })

    it('get_selection is model-only (LLM can call, app cannot)', () => {
      expect(getSelectionTool.visibility).toEqual(['model'])
    })

    it('get_selection description instructs LLM to call first for "selected" records', () => {
      expect(getSelectionTool.toolDescription).toMatch(/FIRST/)
      expect(getSelectionTool.toolDescription).toMatch(/selected/)
      expect(getSelectionTool.toolDescription).toMatch(/bulk_action_models/)
    })
  })

  describe('get_selection tool', () => {
    it('has correct toolName', () => {
      expect(getSelectionTool.toolName).toBe('get_selection')
    })

    it('has visibility model-only', () => {
      expect(getSelectionTool.visibility).toEqual(['model'])
    })

    it('does not need auth', () => {
      expect(getSelectionTool.needsAuth).toBe(false)
    })

    it('does not have getHtml', () => {
      expect(getSelectionTool.getHtml).toBeUndefined()
    })

    it('does not have resourceUri', () => {
      expect(getSelectionTool.resourceUri).toBeUndefined()
    })

    it('returns selection for specific model', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })

      const result = await getSelectionTool.handleToolCall(
        { model: 'activity' },
        { selectionStore }
      )
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.selection).toMatchObject({
        model: 'activity',
        ids: ['1'],
        total: 1
      })
    })

    it('returns null message for unknown model', async () => {
      const selectionStore = new SelectionStore()

      const result = await getSelectionTool.handleToolCall({ model: 'unknown' }, { selectionStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.selection).toBeNull()
      expect(parsed.message).toBe('No selection for unknown')
    })

    it('returns all selections when model omitted', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      selectionStore.set({ model: 'contact', mode: 'filter', filters: { city: 'NY' }, total: 5 })

      const result = await getSelectionTool.handleToolCall({}, { selectionStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.count).toBe(2)
      expect(parsed.selections.activity).toBeDefined()
      expect(parsed.selections.contact).toBeDefined()
      expect(parsed.message).toBe('2 active selection(s)')
    })

    it('returns empty message when no selections and model omitted', async () => {
      const selectionStore = new SelectionStore()

      const result = await getSelectionTool.handleToolCall({}, { selectionStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.count).toBe(0)
      expect(parsed.message).toBe('No active selections')
    })

    it('returns error when no selectionStore', async () => {
      const result = await getSelectionTool.handleToolCall({ model: 'activity' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Selection store not available')
    })

    it('returns error when selectionStore is undefined in context', async () => {
      const result = await getSelectionTool.handleToolCall({}, {})
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Selection store not available')
    })
  })
})
