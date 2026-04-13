import { describe, it, expect } from 'vitest'
import { createSearchViewApp } from '../../../../lib/mcp/apps/search-view.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const modelClasses = {
  book: {
    endpoint: 'books',
    singularName: 'book',
    search: { fullText: { endpoint: 'search' }, autocompleteFields: ['title'] },
    attributes: {
      title: { type: 'string', required: true },
      author: { type: 'string' }
    }
  }
}
const namespace = 'test'

describe('search_records_view', () => {
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
})
