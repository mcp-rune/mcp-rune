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

vi.mock('#src/runtime/logger.js', () => ({
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

import { createDefaultAppRegistry } from '../../../../src/mcp/apps/lib/create-default-registry.js'

class FakeModel {
  static singularName = 'book'
  static api = { endpoint: 'books' }
  static attributes = {
    title: { type: 'string', required: true },
    rating: { type: 'integer' }
  }
  static defaultColumns: string[] | undefined = undefined
  // The pick-model-app / multi-pick-model-app factories filter by the
  // model's `extensions.search` config (see api-extensions/search
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
    // Every framework app tool registers…
    for (const expected of [
      'pick_model_app',
      'new_model_app',
      'show_model_app',
      'find_model_app',
      'multi_pick_model_app',
      'view_selection_app',
      'edit_model_app'
    ]) {
      expect(names).toContain(expected)
    }
    // …and the selection tools thread through whichever factory registers them.
    expect(names).toContain('get_selection')
    expect(names).toContain('add_to_selection')
    expect(names).toContain('clear_selection')
  })

  it('omits apps listed in `exclude` without affecting the others', () => {
    const registry = createDefaultAppRegistry({
      modelClasses: { book: FakeModel as never },
      namespace: 'test-default',
      exclude: ['multi-pick-model-app', 'new-model-app']
    })

    const names = registry.getToolNames()
    expect(names).not.toContain('multi_pick_model_app')
    expect(names).not.toContain('new_model_app')
    expect(names).toContain('find_model_app')
    expect(names).toContain('edit_model_app')
  })

  it('threads themeOverrides and kinds into AppRegistry so injectIntoHead emits them', () => {
    const registry = createDefaultAppRegistry({
      modelClasses: { book: FakeModel as never },
      namespace: 'test-default',
      themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } },
      kinds: { date: { render: { locale: 'en-GB' } } }
    })

    const out = registry.injectIntoHead('<html><head></head><body></body></html>')

    expect(out).toContain('--color-accent:#0a84ff')
    expect(out).toContain('window.__MCP_RUNE_KIND_RENDERERS__')
    expect(out).toContain('en-GB')
  })
})
