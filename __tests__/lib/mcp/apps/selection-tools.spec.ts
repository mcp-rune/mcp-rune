import { SelectionStore } from '../../../../src/mcp/apps/lib/selection-store.js'
import { createSelectionTools } from '../../../../src/mcp/apps/lib/selection-tools.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const resourceUri = 'app://find-model-app'
const modelNames = ['activity', 'contact', 'deal']
const getHtml = () => '<html></html>'

describe('createSelectionTools', () => {
  let tools, selectTool, getSelectionTool, addTool, removeTool, clearTool, materializeTool

  beforeEach(() => {
    tools = createSelectionTools('select_search_records', resourceUri, modelNames, { getHtml })
    selectTool = tools[0]
    getSelectionTool = tools.find((t) => t.toolName === 'get_selection')
    addTool = tools.find((t) => t.toolName === 'add_to_selection')
    removeTool = tools.find((t) => t.toolName === 'remove_from_selection')
    clearTool = tools.find((t) => t.toolName === 'clear_selection')
    materializeTool = tools.find((t) => t.toolName === 'materialize_selection')
  })

  it('returns the per-app select tool plus the five shared model-visible tools', () => {
    expect(tools).toHaveLength(6)
    expect(selectTool.toolName).toBe('select_search_records')
    expect(getSelectionTool).toBeDefined()
    expect(addTool).toBeDefined()
    expect(removeTool).toBeDefined()
    expect(clearTool).toBeDefined()
    expect(materializeTool).toBeDefined()
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

  describe('add_to_selection', () => {
    it('is model-visible', () => {
      expect(addTool.visibility).toEqual(['model'])
    })

    it('unions ids with the existing selection', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1', '2'], total: 2 })

      const result = await addTool.handleToolCall(
        { model: 'activity', ids: ['3'] },
        { selectionStore }
      )
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.ok).toBe(true)
      expect(parsed.selection.ids.sort()).toEqual(['1', '2', '3'])
      expect(parsed.selection.total).toBe(3)
    })

    it('returns error when existing selection is filter-mode', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({
        model: 'activity',
        mode: 'filter',
        filters: { status: 'open' },
        total: 5
      })
      const result = await addTool.handleToolCall(
        { model: 'activity', ids: ['1'] },
        { selectionStore }
      )
      expect(result.isError).toBe(true)
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toMatch(/filter-mode/i)
    })
  })

  describe('remove_from_selection', () => {
    it('is model-visible', () => {
      expect(removeTool.visibility).toEqual(['model'])
    })

    it('drops the given ids from the selection', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1', '2', '3'], total: 3 })

      const result = await removeTool.handleToolCall(
        { model: 'activity', ids: ['2'] },
        { selectionStore }
      )
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.ok).toBe(true)
      expect(parsed.selection.ids).toEqual(['1', '3'])
      expect(parsed.selection.total).toBe(2)
    })

    it('returns null selection and clears entry when every id is removed', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })

      const result = await removeTool.handleToolCall(
        { model: 'activity', ids: ['1'] },
        { selectionStore }
      )
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.selection).toBeNull()
      expect(selectionStore.get('activity')).toBeUndefined()
    })
  })

  describe('clear_selection', () => {
    it('is model-visible', () => {
      expect(clearTool.visibility).toEqual(['model'])
    })

    it('clears one model when model is provided', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      selectionStore.set({ model: 'contact', mode: 'ids', ids: ['2'], total: 1 })

      await clearTool.handleToolCall({ model: 'activity' }, { selectionStore })
      expect(selectionStore.get('activity')).toBeUndefined()
      expect(selectionStore.get('contact')).toBeDefined()
    })

    it('clears every selection when model is omitted', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      selectionStore.set({ model: 'contact', mode: 'ids', ids: ['2'], total: 1 })

      await clearTool.handleToolCall({}, { selectionStore })
      expect(selectionStore.size).toBe(0)
    })
  })

  describe('materialize_selection', () => {
    it('is model-visible and needs auth', () => {
      expect(materializeTool.visibility).toEqual(['model'])
      expect(materializeTool.needsAuth).toBe(true)
    })

    it('replaces a filter-mode entry with the resolved ids', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({
        model: 'activity',
        mode: 'filter',
        filters: { status: 'open' },
        total: 2
      })

      const dataLayer = {
        async searchNormalized(_model, _query, _filters, _pagination) {
          return {
            records: [{ id: 'a1' }, { id: 'a2' }],
            pagination: { page: 1, per_page: 20, total: 2 }
          }
        }
      }

      const result = await materializeTool.handleToolCall(
        { model: 'activity' },
        { selectionStore, dataLayer }
      )
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.ok).toBe(true)
      expect(parsed.selection.mode).toBe('ids')
      expect(parsed.selection.ids).toEqual(['a1', 'a2'])
      expect(parsed.selection.total).toBe(2)
    })

    it('returns ids-mode selection unchanged with an explanatory message', async () => {
      const selectionStore = new SelectionStore()
      selectionStore.set({ model: 'activity', mode: 'ids', ids: ['x'], total: 1 })

      const dataLayer = {
        async searchNormalized() {
          throw new Error('should not be called')
        }
      }

      const result = await materializeTool.handleToolCall(
        { model: 'activity' },
        { selectionStore, dataLayer }
      )
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.ok).toBe(true)
      expect(parsed.selection.ids).toEqual(['x'])
      expect(parsed.message).toMatch(/already ids-mode/)
    })

    it('errors when no selection exists', async () => {
      const selectionStore = new SelectionStore()
      const dataLayer = {
        async searchNormalized() {
          return { records: [], pagination: {} }
        }
      }

      const result = await materializeTool.handleToolCall(
        { model: 'activity' },
        { selectionStore, dataLayer }
      )
      expect(result.isError).toBe(true)
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toMatch(/No selection/)
    })
  })
})
