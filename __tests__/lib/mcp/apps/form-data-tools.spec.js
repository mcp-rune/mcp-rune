import { describe, it, expect, beforeEach } from 'vitest'
import { createFormDataTools } from '../../../../lib/mcp/apps/form-data-tools.js'
import { FormDataStore } from '../../../../lib/mcp/apps/form-data-store.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const resourceUri = 'ui://test/model-form'
const modelNames = ['activity', 'book', 'deal']
const getHtml = () => '<html></html>'

describe('createFormDataTools', () => {
  let tools, collectTool, getFormDataTool

  beforeEach(() => {
    tools = createFormDataTools(resourceUri, modelNames, { getHtml })
    collectTool = tools[0]
    getFormDataTool = tools[1]
  })

  it('returns array of 2 tools', () => {
    expect(tools).toHaveLength(2)
  })

  describe('collect_form_data tool', () => {
    it('has correct toolName', () => {
      expect(collectTool.toolName).toBe('collect_form_data')
    })

    it('has correct resourceUri', () => {
      expect(collectTool.resourceUri).toBe(resourceUri)
    })

    it('has visibility app-only', () => {
      expect(collectTool.visibility).toEqual(['app'])
    })

    it('does not need auth', () => {
      expect(collectTool.needsAuth).toBe(false)
    })

    it('has getHtml function', () => {
      expect(collectTool.getHtml).toBe(getHtml)
    })

    it('stores form data via formDataStore.set()', async () => {
      const formDataStore = new FormDataStore()
      const args = {
        model: 'activity',
        fields: { title: 'Morning Run', status: 'draft' },
        mode: 'create'
      }

      const result = await collectTool.handleToolCall(args, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.ok).toBe(true)
      expect(parsed.entry).toMatchObject({
        model: 'activity',
        fields: { title: 'Morning Run', status: 'draft' },
        mode: 'create'
      })
      expect(formDataStore.get('activity')).toBeDefined()
    })

    it('includes field count in message', async () => {
      const formDataStore = new FormDataStore()
      const args = {
        model: 'activity',
        fields: { title: 'Run', status: 'draft', rating: 5 },
        mode: 'create'
      }

      const result = await collectTool.handleToolCall(args, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.message).toContain('3 fields')
    })

    it('uses singular "field" for 1 field', async () => {
      const formDataStore = new FormDataStore()
      const args = { model: 'activity', fields: { title: 'Run' }, mode: 'create' }

      const result = await collectTool.handleToolCall(args, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.message).toContain('1 field)')
    })

    it('returns error when no formDataStore', async () => {
      const result = await collectTool.handleToolCall({
        model: 'activity',
        fields: { title: 'Run' }
      })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Form data store not available')
    })

    it('returns error when formDataStore is undefined in context', async () => {
      const result = await collectTool.handleToolCall(
        { model: 'activity', fields: { title: 'Run' } },
        {}
      )
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Form data store not available')
    })
  })

  describe('form data flow contract', () => {
    it('collect tool is app-only (LLM cannot call)', () => {
      expect(collectTool.visibility).toEqual(['app'])
    })

    it('get_form_data is model-only (LLM can call, app cannot)', () => {
      expect(getFormDataTool.visibility).toEqual(['model'])
    })

    it('get_form_data description instructs LLM to merge, validate, and review', () => {
      expect(getFormDataTool.toolDescription).toMatch(/merge/)
      expect(getFormDataTool.toolDescription).toMatch(/validate/)
      expect(getFormDataTool.toolDescription).toMatch(/review/)
    })
  })

  describe('get_form_data tool', () => {
    it('has correct toolName', () => {
      expect(getFormDataTool.toolName).toBe('get_form_data')
    })

    it('has visibility model-only', () => {
      expect(getFormDataTool.visibility).toEqual(['model'])
    })

    it('does not need auth', () => {
      expect(getFormDataTool.needsAuth).toBe(false)
    })

    it('does not have getHtml', () => {
      expect(getFormDataTool.getHtml).toBeUndefined()
    })

    it('does not have resourceUri', () => {
      expect(getFormDataTool.resourceUri).toBeUndefined()
    })

    it('returns entry for specific model', async () => {
      const formDataStore = new FormDataStore()
      formDataStore.set({
        model: 'activity',
        fields: { title: 'Run', rating: 5 },
        mode: 'create'
      })

      const result = await getFormDataTool.handleToolCall({ model: 'activity' }, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.entry).toMatchObject({
        model: 'activity',
        fields: { title: 'Run', rating: 5 },
        mode: 'create'
      })
    })

    it('returns null message for unknown model', async () => {
      const formDataStore = new FormDataStore()

      const result = await getFormDataTool.handleToolCall({ model: 'unknown' }, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.entry).toBeNull()
      expect(parsed.message).toBe('No form data collected for unknown')
    })

    it('returns all entries when model omitted', async () => {
      const formDataStore = new FormDataStore()
      formDataStore.set({ model: 'activity', fields: { title: 'Run' }, mode: 'create' })
      formDataStore.set({ model: 'book', fields: { title: 'Clean Code' }, mode: 'update' })

      const result = await getFormDataTool.handleToolCall({}, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.count).toBe(2)
      expect(parsed.entries.activity).toBeDefined()
      expect(parsed.entries.book).toBeDefined()
      expect(parsed.message).toBe('2 form(s) collected')
    })

    it('returns empty message when no entries and model omitted', async () => {
      const formDataStore = new FormDataStore()

      const result = await getFormDataTool.handleToolCall({}, { formDataStore })
      const parsed = JSON.parse(result.content[0].text)

      expect(parsed.count).toBe(0)
      expect(parsed.message).toBe('No form data collected')
    })

    it('returns error when no formDataStore', async () => {
      const result = await getFormDataTool.handleToolCall({ model: 'activity' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Form data store not available')
    })

    it('returns error when formDataStore is undefined in context', async () => {
      const result = await getFormDataTool.handleToolCall({}, {})
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBe('Form data store not available')
    })
  })
})
