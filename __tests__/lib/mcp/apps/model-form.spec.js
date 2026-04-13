import { describe, it, expect } from 'vitest'
import { createCreateFormApp } from '../../../../src/mcp/apps/model-form.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MockModel = {
  endpoint: 'books',
  singularName: 'book',
  attributes: {
    id: { type: 'string', prompt_visible: false },
    title: { type: 'string', required: true },
    status: { type: 'enum', enumValues: ['draft', 'active'], default: 'draft' }
  },
  associations: {}
}

class MockPrompt {
  static title = 'Create Book'
  static fieldGroups = {
    identity: { fields: ['title', 'status'], context: 'Identity' }
  }
  static sections = {
    identity: { title: 'Book Identity', required: true, groups: ['identity'] }
  }

  constructor() {}

  getDefaultFormState() {
    return { status: 'draft' }
  }
}

const MockFormClass = {
  fields: ['title', 'status']
}

const modelClasses = { book: MockModel }
const formClasses = { book: MockFormClass }
const promptClasses = { book: MockPrompt }

function createApp() {
  return createCreateFormApp({ modelClasses, formClasses, promptClasses, namespace: 'test' })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('lib/mcp/apps/model-form', () => {
  describe('mode gate', () => {
    it('returns isError with redirect when mode is not set', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book' })
      expect(result.isError).toBe(true)
      const text = result.content[0].text
      expect(text).toContain('Do not call this tool without mode: "form"')
      expect(text).toContain('get_prompt_guide')
    })

    it('returns form schema when mode is "form"', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book', mode: 'form' })
      const data = JSON.parse(result.content[0].text)
      expect(data.schema).toBeDefined()
      expect(data.schema.model).toBe('book')
      expect(data.defaults).toBeDefined()
      expect(data.mode).toBe('create')
    })

    it('returns error for unknown model even with mode: "form"', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'unknown', mode: 'form' })
      const data = JSON.parse(result.content[0].text)
      expect(data.error).toContain('Unknown model')
    })
  })

  describe('hidden values', () => {
    it('populates hiddenValues from prefill args not in schema fields', async () => {
      const app = createApp()
      const result = await app.handleToolCall({
        model: 'book',
        mode: 'form',
        prefill: { platform_link: '/platforms/1', content_id: '42' }
      })
      const data = JSON.parse(result.content[0].text)
      expect(data.hiddenValues).toEqual({
        platform_link: '/platforms/1',
        content_id: '42'
      })
    })

    it('does not include hiddenValues when all prefill args match schema fields', async () => {
      const app = createApp()
      const result = await app.handleToolCall({
        model: 'book',
        mode: 'form',
        prefill: { title: 'My Book' }
      })
      const data = JSON.parse(result.content[0].text)
      expect(data.hiddenValues).toBeUndefined()
    })

    it('omits hiddenValues key when prefill is empty', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book', mode: 'form' })
      const data = JSON.parse(result.content[0].text)
      expect(data.hiddenValues).toBeUndefined()
    })
  })
})
