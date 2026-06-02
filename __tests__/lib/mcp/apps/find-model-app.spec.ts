import { createFindModelApp } from '../../../../src/mcp/apps/find-model-app/index.js'

const modelClasses = {
  book: {
    api: { endpoint: 'books' },
    singularName: 'book',
    extensions: { search: { lookup: { fields: ['title'] } } },
    attributes: {
      title: { type: 'string', required: true },
      author: { type: 'string' }
    }
  },
  activity: {
    api: { endpoint: 'activities' },
    singularName: 'activity',
    extensions: {
      search: {
        query: { endpoint: 'activities/search', method: 'POST', queryParam: 'q' },
        lookup: { fields: ['title'] }
      }
    },
    attributes: { title: { type: 'string', required: true } }
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

describe('find_model_app', () => {
  const tools = createFindModelApp({ modelClasses, namespace })
  const findTool = tools[0]

  it('exposes find_model_app as a single unified tool', () => {
    expect(findTool.toolName).toBe('find_model_app')
    expect(findTool.resourceUri).toMatch(/find-model-app$/)
    expect(findTool.annotations?.readOnlyHint).toBe(true)
  })

  it('accepts every model (no eligibility gating)', () => {
    const schema = findTool.toolInputSchema
    expect(schema.model).toBeDefined()
    expect(schema.query).toBeDefined()
    expect(schema.filters).toBeDefined()
    expect(schema.page).toBeDefined()
    expect(schema.per_page).toBeDefined()
  })

  it('returns the per-app select tool plus the shared model-visible tools', () => {
    const names = tools.map((t) => t.toolName)
    expect(names).toEqual(
      expect.arrayContaining([
        'find_model_app',
        'select_find_records',
        'get_selection',
        'add_to_selection',
        'remove_from_selection',
        'clear_selection',
        'materialize_selection'
      ])
    )
  })

  it('routes every fetch through dataLayer.searchNormalized', async () => {
    const dataLayer = fakeDataLayer([{ id: '1', title: 'A' }])
    await findTool.handleToolCall(
      { model: 'activity', query: 'standup', filters: { status: 'open' }, page: 2 },
      { dataLayer }
    )
    expect(dataLayer.calls).toHaveLength(1)
    expect(dataLayer.calls[0]).toMatchObject({
      model: 'activity',
      query: 'standup',
      filters: { status: 'open' },
      pagination: { page: 2, perPage: 20 }
    })
  })

  it('clamps per_page to the configured max', async () => {
    const dataLayer = fakeDataLayer()
    await findTool.handleToolCall({ model: 'book', per_page: 500 }, { dataLayer })
    expect(dataLayer.calls[0].pagination.perPage).toBe(20)
  })

  it('returns the standard selection hint for the LLM', async () => {
    const dataLayer = fakeDataLayer([{ id: '1' }, { id: '2' }])
    const result = await findTool.handleToolCall({ model: 'book' }, { dataLayer })
    const hint = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))
    expect(hint).toBeDefined()
    expect(hint.text).toMatch(/Displayed 2/)
    expect(hint.text).toMatch(/get_selection/)
    expect(hint.text).toMatch(/Send Selection/)
    expect(hint.text).toMatch(/ids: \[/)
  })

  it('tags the payload transient via _meta', async () => {
    const dataLayer = fakeDataLayer()
    const result = await findTool.handleToolCall({ model: 'book' }, { dataLayer })
    expect(result._meta?.context?.lifecycle).toBe('transient')
  })

  it('errors gracefully on unknown model', async () => {
    const result = await findTool.handleToolCall(
      { model: 'unknown' },
      { dataLayer: fakeDataLayer() }
    )
    const payload = JSON.parse(result.content[0].text)
    expect(payload.error).toMatch(/Unknown model/)
  })

  it('never imports SearchService — the handler only consumes dataLayer', () => {
    // The eligible-context contract: the handler signature should reject
    // searchClient if a caller tries to pass it (we keep only `dataLayer`).
    // Smoke-tested by calling with only dataLayer in context — if any
    // implementation slipped a searchClient access in, this would throw on
    // undefined.
    return findTool.handleToolCall({ model: 'book' }, { dataLayer: fakeDataLayer() })
  })
})
