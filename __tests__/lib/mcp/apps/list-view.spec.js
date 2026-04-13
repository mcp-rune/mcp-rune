import { describe, it, expect } from 'vitest'
import { createListViewApp } from '../../../../lib/mcp/apps/list-view.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const modelClasses = {
  book: {
    endpoint: 'books',
    singularName: 'book',
    search: { autocompleteFields: ['title'] },
    attributes: {
      title: { type: 'string', required: true },
      author: { type: 'string' }
    }
  }
}
const namespace = 'test'

describe('list_records_view', () => {
  const tools = createListViewApp({ modelClasses, namespace })
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

    expect(hintContent.text).toMatch(/\d+ records displayed/)
  })
})
