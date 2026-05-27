import { createSearchViewApp } from '../../../../src/mcp/apps/search-view.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const modelClasses = {
  book: {
    api: { endpoint: 'books' },
    singularName: 'book',
    extensions: { search: { query: { endpoint: 'search' }, lookup: { fields: ['title'] } } },
    attributes: {
      title: { type: 'string', required: true },
      author: { type: 'string' }
    }
  }
}
const namespace = 'test'

describe('search_records_app', () => {
  const tools = createSearchViewApp({ modelClasses, namespace })
  const searchTool = tools[0]

  it('response includes selection hint for LLM', async () => {
    const result = await searchTool.handleToolCall({ model: 'book', query: 'test' })
    const hintContent = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))

    expect(hintContent).toBeDefined()
    expect(hintContent.text).toMatch(/get_selection/)
    expect(hintContent.text).toMatch(/Send Selection/)
  })

  it('response hint mentions stored IDs', async () => {
    const result = await searchTool.handleToolCall({ model: 'book' })
    const hintContent = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))

    expect(hintContent.text).toMatch(/stored IDs/)
  })

  it('response emits the do-not-echo directive and id list', async () => {
    const result = await searchTool.handleToolCall({ model: 'book', query: 'test' })
    const hint = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))
    expect(hint.text).toMatch(/Displayed \d+/)
    expect(hint.text).toMatch(/Do NOT repeat/)
    expect(hint.text).toMatch(/ids: \[/)
  })

  it('response tags payload transient via _meta.context.lifecycle', async () => {
    const result = await searchTool.handleToolCall({ model: 'book' })
    expect(result._meta?.context?.lifecycle).toBe('transient')
  })

  it('declares readOnlyHint and uses _app suffix', () => {
    expect(searchTool.toolName).toBe('search_records_app')
    expect(searchTool.annotations?.readOnlyHint).toBe(true)
  })
})
