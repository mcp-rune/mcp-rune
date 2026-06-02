import { createShowModelApp } from '../../../../src/mcp/apps/show-model-app.js'

const modelClasses = {
  book: {
    api: { endpoint: 'books' },
    singularName: 'book',
    attributes: {
      title: { type: 'string', required: true },
      author: { type: 'string' }
    }
  }
}
const namespace = 'test'

const dataLayer = {
  dispatch: async (_method: string, path: string) => {
    const id = path.split('/').pop()
    return { data: { id, title: `Book ${id}`, author: 'A' } }
  }
}

describe('show_model_app', () => {
  const app = createShowModelApp({ modelClasses, namespace }) as Record<string, unknown>

  it('renames toolName and resourceUri to use _app suffix', () => {
    expect(app.toolName).toBe('show_model_app')
    expect((app.resourceUri as string).endsWith('show-model-app')).toBe(true)
  })

  it('declares readOnlyHint annotation', () => {
    expect((app.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(true)
  })

  it('emits do-not-echo directive in block 1 and tags payload transient', async () => {
    const handle = app.handleToolCall as (
      args: Record<string, unknown>,
      ctx: Record<string, unknown>
    ) => Promise<{
      content: Array<{ type: string; text: string }>
      _meta?: { context?: { lifecycle?: string; summary?: string } }
    }>
    const result = await handle({ model: 'book', ids: ['1', '2'] }, { dataLayer })

    const block1 = result.content[1]
    expect(block1.text).toMatch(/Displayed 2/)
    expect(block1.text).toMatch(/show_model_app/)
    expect(block1.text).toMatch(/Do NOT repeat/)
    expect(block1.text).toMatch(/ids: \[1, 2\]/)

    expect(result._meta?.context?.lifecycle).toBe('transient')
    expect(typeof result._meta?.context?.summary).toBe('string')
  })

  it('cross-references find_records in its description', () => {
    expect(app.toolDescription).toContain('find_records')
  })
})
