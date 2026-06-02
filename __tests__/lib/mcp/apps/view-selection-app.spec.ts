import { SelectionStore } from '../../../../src/mcp/apps/lib/selection-store.js'
import { createViewSelectionApp } from '../../../../src/mcp/apps/view-selection-app/index.js'

const modelClasses = {
  book: {
    api: { endpoint: 'books' },
    singularName: 'book',
    extensions: { search: { lookup: { fields: ['title'] } } },
    attributes: {
      title: { type: 'string', required: true },
      author: { type: 'string' }
    }
  }
}
const namespace = 'test'

function fakeDataLayer(records = []) {
  return {
    calls: [],
    async searchNormalized(model, query, filters, pagination) {
      this.calls.push({ model, query, filters, pagination })
      return {
        records,
        pagination: {
          page: pagination?.page ?? 1,
          per_page: pagination?.perPage ?? 20,
          total: records.length
        }
      }
    }
  }
}

describe('view_selection_app', () => {
  const tools = createViewSelectionApp({ modelClasses, namespace })
  const viewTool = tools[0]

  it('exposes view_selection_app as the primary tool', () => {
    expect(viewTool.toolName).toBe('view_selection_app')
    expect(viewTool.resourceUri).toMatch(/view-selection-app$/)
    expect(viewTool.annotations?.readOnlyHint).toBe(true)
  })

  it('errors without a selectionStore', async () => {
    const result = await viewTool.handleToolCall({ model: 'book' }, {})
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toMatch(/Selection store/)
  })

  it('returns an empty view when there is no selection for the model', async () => {
    const selectionStore = new SelectionStore()
    const result = await viewTool.handleToolCall(
      { model: 'book' },
      { selectionStore, dataLayer: fakeDataLayer() }
    )
    const payload = JSON.parse(result.content[0].text)
    expect(payload.view).toBe('empty')
    expect(payload.model).toBe('book')
  })

  it('returns the summary view when model is omitted', async () => {
    const selectionStore = new SelectionStore()
    selectionStore.set({ model: 'book', mode: 'ids', ids: ['1', '2'], total: 2 })
    const result = await viewTool.handleToolCall({}, { selectionStore })
    const payload = JSON.parse(result.content[0].text)
    expect(payload.view).toBe('summary')
    expect(payload.selections).toEqual([
      expect.objectContaining({ model: 'book', mode: 'ids', total: 2 })
    ])
  })

  it('resolves ids-mode selections via dataLayer.searchNormalized', async () => {
    const selectionStore = new SelectionStore()
    selectionStore.set({ model: 'book', mode: 'ids', ids: ['1', '2'], total: 2 })
    const dataLayer = fakeDataLayer([
      { id: '1', title: 'A' },
      { id: '2', title: 'B' }
    ])
    const result = await viewTool.handleToolCall({ model: 'book' }, { selectionStore, dataLayer })
    const payload = JSON.parse(result.content[0].text)

    expect(payload.view).toBe('ids')
    expect(payload.records).toHaveLength(2)
    expect(payload.ids).toEqual(['1', '2'])
    expect(dataLayer.calls).toHaveLength(1)
    expect(dataLayer.calls[0]).toMatchObject({
      model: 'book',
      filters: { id: ['1', '2'] }
    })
  })

  it('returns filter-mode view without fetching records', async () => {
    const selectionStore = new SelectionStore()
    selectionStore.set({
      model: 'book',
      mode: 'filter',
      filters: { author: 'Asimov' },
      total: 12
    })
    const dataLayer = fakeDataLayer()
    const result = await viewTool.handleToolCall({ model: 'book' }, { selectionStore, dataLayer })
    const payload = JSON.parse(result.content[0].text)

    expect(payload.view).toBe('filter')
    expect(payload.filters).toEqual({ author: 'Asimov' })
    expect(payload.total).toBe(12)
    expect(dataLayer.calls).toHaveLength(0)
  })

  it('returns the per-app select tool plus the shared model-visible surface', () => {
    const names = tools.map((t) => t.toolName)
    expect(names).toEqual(
      expect.arrayContaining([
        'view_selection_app',
        'select_view_records',
        'get_selection',
        'add_to_selection',
        'remove_from_selection',
        'clear_selection',
        'materialize_selection'
      ])
    )
  })
})
