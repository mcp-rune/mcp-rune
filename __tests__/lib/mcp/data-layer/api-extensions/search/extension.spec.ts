/**
 * End-to-end tests for the `search` extension wired through `ToolRegistry`.
 *
 * Asserts that registering the extension makes `search_records` and
 * `get_filters_guide` available, and that omitting it leaves both absent.
 * Core `static search` config and SearchService stay in place either way —
 * see CHANGELOG for the partial-extraction rationale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { searchExtension } from '#src/mcp/data-layer/api-extensions/search/index.js'

import { DATA_TOOL_CLASSES } from '../../../../../../src/mcp/tools/data/index.js'
import { ToolRegistry } from '../../../../../../src/mcp/tools/tool-registry.js'

vi.mock('#src/services/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('#src/services/tracing.js', () => ({
  traceToolCall: vi.fn((_n, _a, h) => h())
}))
vi.mock('#src/services/vector-storage.js', () => ({
  storeOperation: vi.fn(() => Promise.resolve())
}))

const models = {
  book: {
    api: { endpoint: 'books' },
    attributes: { title: { type: 'string' } },
    description: 'Book',
    extensions: {
      search: {
        lookup: { fields: ['title'] },
        filters: {
          status: { type: 'enum', enumValues: ['draft', 'published'] }
        }
      }
    }
  }
}

function registeredToolNames(registry: ToolRegistry): string[] {
  const names: string[] = []
  registry.registerTools(
    {
      registerTool: (name: string) => {
        names.push(name)
      }
    } as unknown as Parameters<ToolRegistry['registerTools']>[0],
    { getAccessToken: async () => 'token' }
  )
  return names
}

describe('api-extensions/search — end-to-end registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when the extension IS registered', () => {
    it('makes search_records and get_filters_guide available alongside core tools', () => {
      const registry = new ToolRegistry({
        toolClasses: DATA_TOOL_CLASSES,
        models,
        createApiClient: () => ({
          baseUrl: 'https://api.test',
          get: vi.fn(),
          post: vi.fn(),
          put: vi.fn(),
          patch: vi.fn(),
          delete: vi.fn()
        }),
        apiExtensions: {
          search: searchExtension()
        }
      })

      const names = registeredToolNames(registry)
      expect(names).toContain('search_records')
      expect(names).toContain('get_filters_guide')
      expect(names).toContain('list_models')
      expect(names).toContain('find_records')
    })
  })

  describe('when the extension is NOT registered', () => {
    it('search_records and get_filters_guide are absent from registered tools', () => {
      const registry = new ToolRegistry({
        toolClasses: DATA_TOOL_CLASSES,
        models,
        createApiClient: () => ({
          baseUrl: 'https://api.test',
          get: vi.fn(),
          post: vi.fn(),
          put: vi.fn(),
          patch: vi.fn(),
          delete: vi.fn()
        })
        // no apiExtensions
      })

      const names = registeredToolNames(registry)
      expect(names).not.toContain('search_records')
      expect(names).not.toContain('get_filters_guide')
      expect(names).toContain('list_models')
    })
  })
})
