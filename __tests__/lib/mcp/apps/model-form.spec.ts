import { vi } from 'vitest'

import { createCreateFormApp } from '../../../../src/mcp/apps/model-form.js'

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

  describe('submit mode', () => {
    it('defaults submitMode to "direct" when no context is provided', async () => {
      const app = createApp()
      const result = await app.handleToolCall({ model: 'book', mode: 'form' })
      const data = JSON.parse(result.content[0].text)
      expect(data.submitMode).toBe('direct')
    })

    it('echoes formSubmitMode from context (e.g. set by centerOfControlExtension)', async () => {
      const app = createApp()
      const result = await app.handleToolCall(
        { model: 'book', mode: 'form' },
        { formSubmitMode: 'collect' }
      )
      const data = JSON.parse(result.content[0].text)
      expect(data.submitMode).toBe('collect')
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

  describe('parent context banner', () => {
    /**
     * Set up a nested-model fixture: `subdomain` belongs to `domain` and is
     * reached via `domains/:domain_id/subdomains`. The parent-context
     * resolver should fetch the domain record and surface its `name` as
     * the banner label.
     */
    const SubdomainModel = {
      api: {
        endpoint: 'subdomains',
        parent: 'domain',
        standalone: false
      },
      singularName: 'subdomain',
      attributes: {
        id: { type: 'string', prompt_visible: false },
        name: { type: 'string', required: true },
        domain_id: { type: 'integer', required: true, prompt_visible: false }
      },
      associations: {
        belongsTo: { domain: { rel: 'domain', target_model: 'domain' } }
      }
    }
    const DomainModel = {
      api: { endpoint: 'domains' },
      singularName: 'domain',
      attributes: {
        id: { type: 'string', prompt_visible: false },
        name: { type: 'string', required: true }
      },
      associations: {}
    }
    const SubdomainFormClass = { fields: ['name'] }

    function nestedApp() {
      return createCreateFormApp({
        modelClasses: { subdomain: SubdomainModel, domain: DomainModel },
        formClasses: { subdomain: SubdomainFormClass },
        promptClasses: {},
        namespace: 'test'
      })
    }

    it('emits parentContext when the parent id is in hiddenValues', async () => {
      const app = nestedApp()
      const dataLayer = {
        dispatch: vi.fn(async (method: string, endpoint: string) => {
          expect(method).toBe('GET')
          expect(endpoint).toBe('domains/7')
          return { data: { id: 7, name: 'Software Engineering' } }
        })
      }
      const result = await app.handleToolCall(
        { model: 'subdomain', mode: 'form', prefill: { domain_id: '7' } },
        { dataLayer } as unknown as Record<string, unknown>
      )
      const data = JSON.parse(result.content[0].text)
      expect(data.parentContext).toEqual({
        parentModel: 'domain',
        parentId: '7',
        label: 'Software Engineering'
      })
      expect(dataLayer.dispatch).toHaveBeenCalledTimes(1)
    })

    it('falls back to "<parent> #<id>" when the parent record has no name/title/slug', async () => {
      const app = nestedApp()
      const dataLayer = {
        dispatch: vi.fn(async () => ({ data: { id: 7 } }))
      }
      const result = await app.handleToolCall(
        { model: 'subdomain', mode: 'form', prefill: { domain_id: '7' } },
        { dataLayer } as unknown as Record<string, unknown>
      )
      const data = JSON.parse(result.content[0].text)
      expect(data.parentContext).toEqual({
        parentModel: 'domain',
        parentId: '7',
        label: 'domain #7'
      })
    })

    it('omits parentContext when the parent id is missing', async () => {
      const app = nestedApp()
      const dataLayer = { dispatch: vi.fn() }
      const result = await app.handleToolCall({ model: 'subdomain', mode: 'form' }, {
        dataLayer
      } as unknown as Record<string, unknown>)
      const data = JSON.parse(result.content[0].text)
      expect(data.parentContext).toBeUndefined()
      expect(dataLayer.dispatch).not.toHaveBeenCalled()
    })

    it('omits parentContext when no dataLayer is provided', async () => {
      const app = nestedApp()
      const result = await app.handleToolCall({
        model: 'subdomain',
        mode: 'form',
        prefill: { domain_id: '7' }
      })
      const data = JSON.parse(result.content[0].text)
      expect(data.parentContext).toBeUndefined()
    })

    it('omits parentContext for standalone models even when their parent fetch would succeed', async () => {
      const app = createApp()
      const dataLayer = { dispatch: vi.fn() }
      const result = await app.handleToolCall({ model: 'book', mode: 'form' }, {
        dataLayer
      } as unknown as Record<string, unknown>)
      const data = JSON.parse(result.content[0].text)
      expect(data.parentContext).toBeUndefined()
    })

    it('logs a warning and omits parentContext when the parent fetch fails', async () => {
      const app = nestedApp()
      const dataLayer = {
        dispatch: vi.fn(async () => {
          throw new Error('404 not found')
        })
      }
      const result = await app.handleToolCall(
        { model: 'subdomain', mode: 'form', prefill: { domain_id: '7' } },
        { dataLayer } as unknown as Record<string, unknown>
      )
      const data = JSON.parse(result.content[0].text)
      expect(data.parentContext).toBeUndefined()
    })
  })
})
