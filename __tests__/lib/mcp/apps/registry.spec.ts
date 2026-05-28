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

vi.mock('#src/services/logger.js', () => mockLogger)

import { AppRegistry } from '../../../../src/mcp/apps/registry.js'

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
      const app1 = makeApp({ toolName: 'search_records_app' })
      const app2 = makeApp({ toolName: 'list_records_app' })
      const app3 = makeApp({ toolName: 'find_records_app' })
      const registry = new AppRegistry([app1, app2, app3])
      expect(registry.getToolNames()).toEqual([
        'search_records_app',
        'list_records_app',
        'find_records_app'
      ])
    })

    it('should return empty array when no apps', () => {
      const registry = new AppRegistry([])
      expect(registry.getToolNames()).toEqual([])
    })
  })

  describe('injectIntoHead', () => {
    const BASE_HTML = '<html><head><title>App</title></head><body></body></html>'

    it('returns the html unchanged when no overrides or header icon are configured', () => {
      const registry = new AppRegistry()
      expect(registry.injectIntoHead(BASE_HTML)).toBe(BASE_HTML)
    })

    it('injects the header icon as a CSS variable inside a single style block', () => {
      const registry = new AppRegistry([], { headerIcon: 'data:image/svg+xml,icon' })

      const out = registry.injectIntoHead(BASE_HTML)

      expect(out).toContain('<style>:root{--header-icon:url("data:image/svg+xml,icon");}</style>')
      expect(out).toContain('</style></head>')
      expect(out.match(/<style>/g)).toHaveLength(1)
    })

    it('merges themeOverrides cssVariables and raw css into one style block', () => {
      const registry = new AppRegistry([], {
        themeOverrides: {
          cssVariables: { '--color-accent': '#0a84ff', '--border-radius-md': '10px' },
          css: '.app{margin:0}'
        }
      })

      const out = registry.injectIntoHead(BASE_HTML)

      expect(out).toContain('--color-accent:#0a84ff')
      expect(out).toContain('--border-radius-md:10px')
      expect(out).toContain('.app{margin:0}')
      expect(out.match(/<style>/g)).toHaveLength(1)
    })

    it('combines headerIcon and themeOverrides into the same style block', () => {
      const registry = new AppRegistry([], {
        headerIcon: 'data:icon',
        themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } }
      })

      const out = registry.injectIntoHead(BASE_HTML)
      const styleMatch = out.match(/<style>([^<]*)<\/style>/)

      expect(styleMatch).not.toBeNull()
      expect(styleMatch![1]).toContain('--header-icon:url("data:icon")')
      expect(styleMatch![1]).toContain('--color-accent:#0a84ff')
    })

    it('emits only raw css when no cssVariables are configured', () => {
      const registry = new AppRegistry([], {
        themeOverrides: { css: '.app{padding:8px}' }
      })

      const out = registry.injectIntoHead(BASE_HTML)

      expect(out).toContain('<style>.app{padding:8px}</style></head>')
      expect(out).not.toContain(':root{')
    })

    it('serializes declarative formatter descriptors into a script block before the style block', () => {
      const registry = new AppRegistry([], {
        formatters: { date: { display: { locale: 'en-GB' } } },
        themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } }
      })

      const out = registry.injectIntoHead(BASE_HTML)

      const scriptIdx = out.indexOf('<script>')
      const styleIdx = out.indexOf('<style>')
      expect(scriptIdx).toBeGreaterThan(-1)
      expect(styleIdx).toBeGreaterThan(-1)
      expect(scriptIdx).toBeLessThan(styleIdx)
      expect(out).toContain('window.__MCP_RUNE_FORMATTERS__=')
      expect(out).toContain('"date"')
      expect(out).toContain('en-GB')
    })

    it('serializes the full FormatterDescriptor shape (label, describe, htmlInputType, validation)', () => {
      const registry = new AppRegistry([], {
        formatters: {
          'string:isbn': {
            label: 'ISBN',
            htmlInputType: 'text',
            promptType: 'string',
            validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
            display: { template: 'ISBN: {value}' }
          }
        }
      })
      const out = registry.injectIntoHead(BASE_HTML)
      expect(out).toContain('"label":"ISBN"')
      expect(out).toContain('"htmlInputType":"text"')
      expect(out).toContain('"pattern":"^[0-9-]+$"')
      expect(out).toContain('"template":"ISBN: {value}"')
    })

    it('escapes </script> sequences inside the serialized JSON', () => {
      const registry = new AppRegistry([], {
        formatters: { string: { display: { template: '</script><x>' } } }
      })

      const out = registry.injectIntoHead(BASE_HTML)

      expect(out).not.toMatch(/<\/script><x>/)
      expect(out).toContain('<\\/script>')
    })
  })
})
