import type * as FsModule from 'node:fs'

const { mockRegisterAppTool, mockRegisterAppResource } = vi.hoisted(() => ({
  mockRegisterAppTool: vi.fn(),
  mockRegisterAppResource: vi.fn()
}))

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: mockRegisterAppTool,
  registerAppResource: mockRegisterAppResource,
  RESOURCE_MIME_TYPE: 'text/html;profile=mcp-app'
}))

vi.mock('#src/services/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Apps that read their bundled HTML from `dist/` at request time would crash
// in the test environment. Stub `getHtml` calls by mocking `fs.readFileSync`
// to return a placeholder for the six `.html` files.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof FsModule>('node:fs')
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn((path: string, ...rest: unknown[]) => {
        if (typeof path === 'string' && path.endsWith('.html')) {
          return '<html><head></head><body></body></html>'
        }
        return (actual.readFileSync as unknown as (p: string, ...r: unknown[]) => unknown)(
          path,
          ...rest
        )
      })
    },
    readFileSync: vi.fn((path: string, ...rest: unknown[]) => {
      if (typeof path === 'string' && path.endsWith('.html')) {
        return '<html><head></head><body></body></html>'
      }
      return (actual.readFileSync as unknown as (p: string, ...r: unknown[]) => unknown)(
        path,
        ...rest
      )
    })
  }
})

import { createDefaultAppRegistry } from '../../../../src/mcp/apps/create-default-registry.js'

class FakeModel {
  static singularName = 'book'
  static api = { endpoint: 'books' }
  static attributes = {
    title: { type: 'string', required: true },
    rating: { type: 'integer' }
  }
  static defaultColumns: string[] | undefined = undefined
  // The search-view / autocomplete-picker / multi-select factories filter
  // by the model's `extensions.search` config (see api-extensions/search
  // capabilities), so declare both `query` and `lookup` to keep every app
  // eligible.
  static extensions = {
    search: {
      query: { fields: ['title'] },
      lookup: { fields: ['title'] }
    }
  }

  constructor(public data: Record<string, unknown>) {}
  get displayValue() {
    return String(this.data.title ?? '')
  }
  get lookupFields() {
    return { title: this.data.title }
  }
}

describe('createDefaultAppRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers tools and resources for every eligible framework app', () => {
    const registry = createDefaultAppRegistry({
      modelClasses: { book: FakeModel as never },
      namespace: 'test-default'
    })

    const names = registry.getToolNames()
    // All seven framework app tools register…
    for (const expected of [
      'autocomplete_picker',
      'create_model_form',
      'find_records_app',
      'list_records_app',
      'multi_select_picker',
      'search_records_app',
      'update_model_form'
    ]) {
      expect(names).toContain(expected)
    }
    // …and `createListViewApp` also threads its selection tools through.
    expect(names).toContain('get_selection')
  })

  it('omits apps listed in `exclude` without affecting the others', () => {
    const registry = createDefaultAppRegistry({
      modelClasses: { book: FakeModel as never },
      namespace: 'test-default',
      exclude: ['multi-select', 'create-form']
    })

    const names = registry.getToolNames()
    expect(names).not.toContain('multi_select_picker')
    expect(names).not.toContain('create_model_form')
    expect(names).toContain('list_records_app')
    expect(names).toContain('update_model_form')
  })

  it('threads themeOverrides and formatters into AppRegistry so injectIntoHead emits them', () => {
    const registry = createDefaultAppRegistry({
      modelClasses: { book: FakeModel as never },
      namespace: 'test-default',
      themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } },
      formatters: { date: { display: { locale: 'en-GB' } } },
      formatterScript: 'window.__MCP_RUNE_REGISTER_FORMATTERS__ = ()=>{}'
    })

    const out = registry.injectIntoHead('<html><head></head><body></body></html>')

    expect(out).toContain('--color-accent:#0a84ff')
    expect(out).toContain('window.__MCP_RUNE_FORMATTERS__')
    expect(out).toContain('en-GB')
    expect(out).toContain('window.__MCP_RUNE_REGISTER_FORMATTERS__ = ()=>{}')
  })
})
