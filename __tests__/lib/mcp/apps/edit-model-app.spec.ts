import { vi } from 'vitest'

import { createEditModelApp } from '../../../../src/mcp/apps/edit-model-app/index.js'
import { createNewModelApp } from '../../../../src/mcp/apps/new-model-app/index.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MockModel = {
  api: { endpoint: 'books' },
  singularName: 'book',
  attributes: {
    id: { type: 'string', prompt_visible: false },
    title: { type: 'string', required: true },
    status: { type: 'enum', enumValues: ['draft', 'active'], default: 'draft' }
  },
  associations: {}
}

class MockPrompt {
  static title = 'Edit Book'
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
  return createEditModelApp({ modelClasses, formClasses, promptClasses, namespace: 'test' })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('lib/mcp/apps/edit-model-app', () => {
  describe('tool shape', () => {
    it('produces toolName "edit_model_app"', () => {
      expect(createApp().toolName).toBe('edit_model_app')
    })

    it('requires record_id and model in toolInputSchema', () => {
      const schema = createApp().toolInputSchema
      expect(schema.model).toBeDefined()
      expect(schema.record_id).toBeDefined()
      // edit has no mode gate
      expect(schema.mode).toBeUndefined()
    })

    it('uses a distinct resourceUri from new_model_app', () => {
      const editApp = createApp()
      const newApp = createNewModelApp({
        modelClasses,
        formClasses,
        promptClasses,
        namespace: 'test'
      })
      expect(editApp.resourceUri).toBe('ui://test/edit-model-app')
      expect(newApp.resourceUri).toBe('ui://test/new-model-app')
      expect(editApp.resourceUri).not.toBe(newApp.resourceUri)
    })
  })

  describe('handleToolCall', () => {
    it('returns mode "update" and echoes recordId on the result', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book', record_id: '42' })
      const data = JSON.parse(result.content[0].text)
      expect(data.mode).toBe('update')
      expect(data.recordId).toBe('42')
      expect(data.schema).toBeDefined()
      expect(data.schema.model).toBe('book')
    })

    it('does NOT have a mode gate — accepts calls without mode: "form"', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book', record_id: '42' })
      expect(result.isError).toBeFalsy()
    })

    it('returns error for unknown model', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'unknown', record_id: '1' })
      const data = JSON.parse(result.content[0].text)
      expect(data.error).toContain('Unknown model')
    })

    it('fetches the record via dataLayer to prefill defaults', async () => {
      const app = createApp()
      const dataLayer = {
        dispatch: vi.fn(async (method: string, endpoint: string) => {
          expect(method).toBe('GET')
          expect(endpoint).toBe('books/42')
          return { data: { id: 42, title: 'Refactoring', status: 'active' } }
        })
      }
      const result = await app.handleToolCall({ model: 'book', record_id: '42' }, {
        dataLayer
      } as unknown as Record<string, unknown>)
      const data = JSON.parse(result.content[0].text)
      expect(data.defaults).toMatchObject({
        id: 42,
        title: 'Refactoring',
        status: 'active'
      })
      // record fetch + association options sweep (empty) = at least the GET books/42 above
      expect(dataLayer.dispatch).toHaveBeenCalled()
    })

    it('echoes formSubmitMode from context (e.g. set by centerOfControlExtension)', async () => {
      const app = createApp()
      const result = await app.handleToolCall(
        { model: 'book', record_id: '42' },
        { formSubmitMode: 'collect' }
      )
      const data = JSON.parse(result.content[0].text)
      expect(data.submitMode).toBe('collect')
    })

    it('defaults submitMode to "direct" when no context is provided', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book', record_id: '42' })
      const data = JSON.parse(result.content[0].text)
      expect(data.submitMode).toBe('direct')
    })
  })
})
