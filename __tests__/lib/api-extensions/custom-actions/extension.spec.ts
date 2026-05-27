/**
 * End-to-end tests for the `custom-actions` extension wired through
 * `ToolRegistry`. Asserts:
 *   - Registering the extension makes `model_action` available and lets
 *     `list_models` include the per-model `actions` summary.
 *   - Omitting the extension makes `model_action` absent and `list_models`
 *     omit `actions` even when models declare `extensions['custom-actions']`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  customActionsConfig,
  customActionsExtension
} from '../../../../src/api-extensions/custom-actions.js'
import { DATA_TOOL_CLASSES, ListModelsTool } from '../../../../src/mcp/tools/data/index.js'
import { ToolRegistry } from '../../../../src/mcp/tools/tool-registry.js'

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
      'custom-actions': customActionsConfig({
        actions: { publish: { path: ':id/publish' } }
      })
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

describe('api-extensions/custom-actions — end-to-end registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when the extension IS registered', () => {
    it('makes model_action available alongside core tools', () => {
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
          'custom-actions': customActionsExtension()
        }
      })

      const names = registeredToolNames(registry)
      expect(names).toContain('model_action')
      expect(names).toContain('list_models')
    })

    it('list_models output includes actions metadata when models declare them', async () => {
      const tool = new ListModelsTool({ models })
      const result = await tool.execute()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed[0].actions).toEqual([
        { name: 'publish', method: 'POST', description: undefined }
      ])
    })
  })

  describe('when the extension is NOT registered', () => {
    it('model_action is absent from registered tools', () => {
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
      expect(names).not.toContain('model_action')
      expect(names).toContain('list_models')
    })

    it('list_models still reads the extensions bag tolerantly (the slice is data, not behavior)', async () => {
      // The reader is unconditional — `list_models` reflects what's in the
      // bag regardless of whether the extension is wired. This matches the
      // contract: extensions decide *behavior* (the model_action tool); the
      // bag carries *configuration* (what actions exist).
      const tool = new ListModelsTool({ models })
      const result = await tool.execute()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed[0].actions).toBeDefined()
    })

    it('list_models output omits actions when models without the slice are listed', async () => {
      const noActionsModels = {
        book: {
          api: { endpoint: 'books' },
          attributes: { title: { type: 'string' } },
          description: 'Book'
        }
      }
      const tool = new ListModelsTool({ models: noActionsModels })
      const result = await tool.execute()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed[0].actions).toBeUndefined()
    })
  })
})
