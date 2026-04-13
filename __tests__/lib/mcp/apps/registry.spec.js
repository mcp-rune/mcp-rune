import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRegisterAppTool, mockRegisterAppResource, mockLogger } = vi.hoisted(() => ({
  mockRegisterAppTool: vi.fn(),
  mockRegisterAppResource: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: mockRegisterAppTool,
  registerAppResource: mockRegisterAppResource,
  RESOURCE_MIME_TYPE: 'text/html;profile=mcp-app'
}))

vi.mock('#lib/services/logger.js', () => mockLogger)

import { AppRegistry } from '../../../../lib/mcp/apps/registry.js'

function makeApp(overrides = {}) {
  return {
    resourceUri: 'ui://test/app',
    toolName: 'test_tool',
    needsAuth: false,
    name: 'Test App',
    description: 'A test app',
    toolDescription: 'A test tool',
    toolInputSchema: {},
    handleToolCall: vi.fn(() => ({ content: [{ type: 'text', text: 'ok' }] })),
    getHtml: vi.fn(() => '<html></html>'),
    ...overrides
  }
}

describe('AppRegistry logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registerTools — error boundary', () => {
    it('logs info on tool call entry', async () => {
      const app = makeApp()
      const registry = new AppRegistry([app])
      registry.registerTools({})

      const handler = mockRegisterAppTool.mock.calls[0][3]
      await handler({})

      expect(mockLogger.info).toHaveBeenCalledWith('App tool called', {
        service: 'mcp-app',
        app: 'test_tool'
      })
    })

    it('logs error and returns isError response on auth failure', async () => {
      const app = makeApp({ needsAuth: true })
      const mockGetAccessToken = vi.fn(async () => {
        throw new Error('Token expired')
      })
      const registry = new AppRegistry([app], {
        apiUrl: 'http://api.test',
        createApiClient: vi.fn()
      })
      registry.registerTools({}, { getAccessToken: mockGetAccessToken })

      const handler = mockRegisterAppTool.mock.calls[0][3]
      const result = await handler({})

      expect(mockLogger.error).toHaveBeenCalledWith(
        'App tool error',
        expect.objectContaining({
          service: 'mcp-app',
          app: 'test_tool',
          errorType: 'Error',
          error: 'Token expired'
        })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('test_tool failed')
      expect(result.content[0].text).toContain('Token expired')
    })

    it('logs error and returns isError response on handleToolCall failure', async () => {
      const app = makeApp({
        handleToolCall: vi.fn(() => {
          throw new Error('Unexpected crash')
        })
      })
      const registry = new AppRegistry([app])
      registry.registerTools({})

      const handler = mockRegisterAppTool.mock.calls[0][3]
      const result = await handler({})

      expect(mockLogger.error).toHaveBeenCalledWith(
        'App tool error',
        expect.objectContaining({
          service: 'mcp-app',
          app: 'test_tool',
          error: 'Unexpected crash'
        })
      )
      expect(result.isError).toBe(true)
    })

    it('does not log error on successful call', async () => {
      const app = makeApp()
      const registry = new AppRegistry([app])
      registry.registerTools({})

      const handler = mockRegisterAppTool.mock.calls[0][3]
      await handler({})

      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('includes httpStatus in error meta when available', async () => {
      const app = makeApp({ needsAuth: true })
      const mockGetAccessToken = vi.fn(async () => {
        const err = new Error('Unauthorized')
        err.response = { status: 401 }
        throw err
      })
      const registry = new AppRegistry([app], {
        apiUrl: 'http://api.test',
        createApiClient: vi.fn()
      })
      registry.registerTools({}, { getAccessToken: mockGetAccessToken })

      const handler = mockRegisterAppTool.mock.calls[0][3]
      await handler({})

      expect(mockLogger.error).toHaveBeenCalledWith(
        'App tool error',
        expect.objectContaining({
          httpStatus: 401
        })
      )
    })
  })

  describe('registerResources — HTML error handling', () => {
    it('logs error and re-throws when getHtml fails', () => {
      const app = makeApp({
        getHtml: vi.fn(() => {
          throw new Error('ENOENT: file not found')
        })
      })
      const registry = new AppRegistry([app])
      registry.registerResources({})

      const readCallback = mockRegisterAppResource.mock.calls[0][4]

      expect(() => readCallback()).toThrow('ENOENT: file not found')
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load app HTML',
        expect.objectContaining({
          service: 'mcp-app',
          app: 'Test App',
          resourceUri: 'ui://test/app',
          errorType: 'Error',
          error: 'ENOENT: file not found'
        })
      )
    })

    it('does not log error when getHtml succeeds', () => {
      const app = makeApp()
      const registry = new AppRegistry([app])
      registry.registerResources({})

      const readCallback = mockRegisterAppResource.mock.calls[0][4]
      readCallback()

      expect(mockLogger.error).not.toHaveBeenCalled()
    })
  })

  describe('getToolNames', () => {
    it('should return all registered app tool names', () => {
      const app1 = makeApp({ toolName: 'search_records_view' })
      const app2 = makeApp({ toolName: 'list_records_view' })
      const app3 = makeApp({ toolName: 'view_records' })
      const registry = new AppRegistry([app1, app2, app3])
      expect(registry.getToolNames()).toEqual([
        'search_records_view',
        'list_records_view',
        'view_records'
      ])
    })

    it('should return empty array when no apps', () => {
      const registry = new AppRegistry([])
      expect(registry.getToolNames()).toEqual([])
    })
  })
})
