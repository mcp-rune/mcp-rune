import { createListModelApp } from '../../../../src/mcp/apps/list-model-app/index.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

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

describe('list_model_app', () => {
  const tools = createListModelApp({ modelClasses, namespace })
  const listTool = tools[0]

  it('response includes selection hint for LLM', async () => {
    const result = await listTool.handleToolCall({ model: 'book' })
    const hintContent = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))

    expect(hintContent).toBeDefined()
    expect(hintContent.text).toMatch(/get_selection/)
    expect(hintContent.text).toMatch(/Send Selection/)
  })

  it('response hint mentions stored IDs', async () => {
    const result = await listTool.handleToolCall({ model: 'book' })
    const hintContent = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))

    expect(hintContent.text).toMatch(/stored IDs/)
  })

  it('response includes record count in hint', async () => {
    const result = await listTool.handleToolCall({ model: 'book' })
    const hintContent = result.content.find((c) => c.type === 'text' && !c.text.startsWith('{'))

    expect(hintContent.text).toMatch(/Displayed \d+/)
    expect(hintContent.text).toMatch(/Do NOT repeat/)
    expect(hintContent.text).toMatch(/ids: \[/)
  })

  it('response tags payload transient via _meta.context.lifecycle', async () => {
    const result = await listTool.handleToolCall({ model: 'book' })
    expect(result._meta?.context?.lifecycle).toBe('transient')
    expect(typeof result._meta?.context?.summary).toBe('string')
  })

  it('declares readOnlyHint annotation', () => {
    expect(listTool.annotations?.readOnlyHint).toBe(true)
  })

  it('uses _app suffix in toolName and resourceUri', () => {
    expect(listTool.toolName).toBe('list_model_app')
    expect(listTool.resourceUri).toMatch(/list-model-app$/)
  })
})
