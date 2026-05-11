import { createRecordDetailApp } from '../../../../src/mcp/apps/record-detail.js'

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

const apiClient = {
  get: async (path: string) => {
    const id = path.split('/').pop()
    return { data: { id, title: `Book ${id}`, author: 'A' } }
  }
}

describe('find_records_app', () => {
  const app = createRecordDetailApp({ modelClasses, namespace }) as Record<string, unknown>

  it('renames toolName and resourceUri to use _app suffix', () => {
    expect(app.toolName).toBe('find_records_app')
    expect((app.resourceUri as string).endsWith('find-records-app')).toBe(true)
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
    const result = await handle({ model: 'book', ids: ['1', '2'] }, { apiClient })

    const block1 = result.content[1]
    expect(block1.text).toMatch(/Displayed 2/)
    expect(block1.text).toMatch(/find_records_app/)
    expect(block1.text).toMatch(/Do NOT repeat/)
    expect(block1.text).toMatch(/ids: \[1, 2\]/)

    expect(result._meta?.context?.lifecycle).toBe('transient')
    expect(typeof result._meta?.context?.summary).toBe('string')
  })

  it('cross-references find_records in its description', () => {
    expect(app.toolDescription).toContain('find_records')
  })
})
