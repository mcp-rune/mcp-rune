/**
 * HttpExtension mechanism tests
 *
 * Verifies how HttpServer registers extensions: ctx shape, capability
 * validation, mount ordering relative to built-in routers. Does NOT send
 * real HTTP requests — supertest isn't a project dep — so mount-order
 * checks inspect the Express router stack directly.
 */

const {
  mockTransport,
  MockStreamableHTTPServerTransport,
  mockLogger,
  mockRequestIdMiddleware,
  mockRequestLoggerMiddleware,
  mockOAuthRouter,
  mockExtractBearerToken,
  mockSendUnauthorized
} = vi.hoisted(() => ({
  mockTransport: { handleRequest: vi.fn(), close: vi.fn(), sessionId: null },
  MockStreamableHTTPServerTransport: vi.fn(function () {
    return { handleRequest: vi.fn(), close: vi.fn(), onclose: null, sessionId: null }
  }),
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockRequestIdMiddleware: vi.fn(() => (req, res, next) => {
    req.requestId = 'test-request-id'
    next()
  }),
  mockRequestLoggerMiddleware: vi.fn(() => (req, res, next) => next()),
  mockOAuthRouter: vi.fn(() => (req, res, next) => next()),
  mockExtractBearerToken: vi.fn(() => null),
  mockSendUnauthorized: vi.fn()
}))

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: MockStreamableHTTPServerTransport
}))
vi.mock('#src/services/logger.js', () => mockLogger)
vi.mock('../../../../src/mcp/middleware/request-id.js', () => ({
  createRequestIdMiddleware: mockRequestIdMiddleware
}))
vi.mock('../../../../src/mcp/middleware/request-logger.js', () => ({
  createRequestLoggerMiddleware: mockRequestLoggerMiddleware
}))
vi.mock('../../../../src/mcp/middleware/oauth-router.js', () => ({
  createOAuthRouter: mockOAuthRouter,
  extractBearerToken: mockExtractBearerToken,
  sendUnauthorized: mockSendUnauthorized
}))

import { HttpServer } from '../../../../src/mcp/http-server.js'

describe('lib/mcp/extensions — HttpExtension mechanism', () => {
  let mockOauth
  let mockMcp

  beforeEach(() => {
    vi.clearAllMocks()

    mockOauth = {
      authServerUrl: 'https://identity.example.com',
      resourceUri: null,
      applyDefaultResourceUri: vi.fn(function (uri) {
        if (!this.resourceUri) this.resourceUri = uri
      }),
      introspectToken: vi.fn()
    }
    mockMcp = {
      name: 'test-mcp',
      createServer: vi.fn(() => ({ connect: vi.fn(), close: vi.fn() }))
    }
  })

  describe('registration ctx', () => {
    it('invokes register() once per extension with the registration key as ctx.name', () => {
      const register = vi.fn()
      new HttpServer({
        port: 0,
        oauth: mockOauth,
        mcp: mockMcp,
        extensions: { 'my-ext': { register } }
      })

      expect(register).toHaveBeenCalledTimes(1)
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-ext' }))
    })

    it('passes baseUrl, pathPrefix, mcpName, oauth, logger, and a fresh router', () => {
      const register = vi.fn()
      new HttpServer({
        port: 3000,
        baseUrl: 'https://mcp.example.com',
        pathPrefix: '/api',
        oauth: mockOauth,
        mcp: mockMcp,
        extensions: { probe: { register } }
      })

      const ctx = register.mock.calls[0][0]
      expect(ctx.baseUrl).toBe('https://mcp.example.com')
      expect(ctx.pathPrefix).toBe('/api')
      expect(ctx.mcpName).toBe('test-mcp')
      expect(ctx.oauth).toBe(mockOauth)
      expect(ctx.logger).toBeDefined()
      // Express Router is a function with .use/.get/.post/etc
      expect(typeof ctx.router).toBe('function')
      expect(typeof ctx.router.get).toBe('function')
    })

    it('passes oauth as null in token mode', () => {
      const register = vi.fn()
      new HttpServer({
        port: 0,
        accessToken: 'static-token',
        mcp: mockMcp,
        extensions: { probe: { register } }
      })

      expect(register).toHaveBeenCalledWith(expect.objectContaining({ oauth: null }))
    })

    it('invokes extensions in object insertion order', () => {
      const calls = []
      const ext = (label) => ({
        register: () => {
          calls.push(label)
        }
      })

      new HttpServer({
        port: 0,
        oauth: mockOauth,
        mcp: mockMcp,
        extensions: { alpha: ext('a'), beta: ext('b'), gamma: ext('c') }
      })

      expect(calls).toEqual(['a', 'b', 'c'])
    })

    it('logs an info line on each registration', () => {
      new HttpServer({
        port: 0,
        oauth: mockOauth,
        mcp: mockMcp,
        extensions: { alpha: { register: () => {} } }
      })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Extension "alpha" registered',
        expect.objectContaining({ extensionName: 'alpha', service: 'test-mcp' })
      )
    })
  })

  describe('capability validation', () => {
    it('throws when requires:["oauth"] but server is in token mode', () => {
      const ext = { requires: ['oauth'], register: vi.fn() }
      expect(
        () =>
          new HttpServer({
            port: 0,
            accessToken: 'token',
            mcp: mockMcp,
            extensions: { needsOauth: ext }
          })
      ).toThrow(/Extension "needsOauth" requires OAuth/)
    })

    it('does not invoke register() when the capability check fails', () => {
      const register = vi.fn()
      expect(
        () =>
          new HttpServer({
            port: 0,
            accessToken: 'token',
            mcp: mockMcp,
            extensions: { needsOauth: { requires: ['oauth'], register } }
          })
      ).toThrow()
      expect(register).not.toHaveBeenCalled()
    })

    it('does not throw when requires is omitted on a token-mode server', () => {
      expect(
        () =>
          new HttpServer({
            port: 0,
            accessToken: 'token',
            mcp: mockMcp,
            extensions: { noReqs: { register: () => {} } }
          })
      ).not.toThrow()
    })

    it('does not throw when requires:["oauth"] and oauth IS configured', () => {
      expect(
        () =>
          new HttpServer({
            port: 0,
            oauth: mockOauth,
            mcp: mockMcp,
            extensions: { needsOauth: { requires: ['oauth'], register: () => {} } }
          })
      ).not.toThrow()
    })
  })

  describe('mount ordering', () => {
    // The plan promises extensions mount AFTER built-in OAuth + status routers
    // and BEFORE the /mcp transport. We assert this by counting OAuth/status
    // mounts that appear before the extension's router in the Express stack.
    it('mounts extension routers after the built-in OAuth router', () => {
      // mockOAuthRouter is the function returned by vi.fn(() => () => {}); on
      // each HttpServer construction it's invoked and the returned middleware
      // is added to app._router.stack. Count `use`-type layers before and
      // after wiring the extension.
      const sentinel = vi.fn((req, res, next) => next())
      const ext = {
        register({ router }) {
          // Mount distinctive middleware so we can find this extension's
          // router in app._router.stack.
          router.use(sentinel)
        }
      }
      const server = new HttpServer({
        port: 0,
        oauth: mockOauth,
        mcp: mockMcp,
        extensions: { probe: ext }
      })

      // Find the position of the extension's mounted router in the app stack.
      // Express wraps each `app.use(prefix, router)` as a layer with `.handle`
      // pointing at the router. The router instance has `.stack` containing
      // the sentinel.
      const layers = server.app.router.stack
      const extLayerIdx = layers.findIndex(
        (l) =>
          l.handle &&
          typeof l.handle === 'function' &&
          l.handle.stack?.some((s) => s.handle === sentinel)
      )

      // The OAuth router was registered by app.use(prefix, oauthRouter); its
      // layer index must precede the extension layer.
      const oauthLayerIdx = layers.findIndex(
        (l) => l.handle === mockOAuthRouter.mock.results[0]?.value
      )

      expect(extLayerIdx).toBeGreaterThan(-1)
      expect(oauthLayerIdx).toBeGreaterThan(-1)
      expect(extLayerIdx).toBeGreaterThan(oauthLayerIdx)
    })

    it('mounts extension routers before the /mcp transport route', () => {
      const sentinel = vi.fn((req, res, next) => next())
      const ext = {
        register({ router }) {
          router.use(sentinel)
        }
      }
      const server = new HttpServer({
        port: 0,
        oauth: mockOauth,
        mcp: mockMcp,
        extensions: { probe: ext }
      })

      const layers = server.app.router.stack
      const extLayerIdx = layers.findIndex(
        (l) =>
          l.handle &&
          typeof l.handle === 'function' &&
          l.handle.stack?.some((s) => s.handle === sentinel)
      )
      // The /mcp route is registered via `app.all`, which creates a layer
      // whose `.route.path` is `/mcp`. Find it.
      const mcpRouteIdx = layers.findIndex((l) => l.route?.path === '/mcp')

      expect(extLayerIdx).toBeGreaterThan(-1)
      expect(mcpRouteIdx).toBeGreaterThan(-1)
      expect(extLayerIdx).toBeLessThan(mcpRouteIdx)
    })
  })

  describe('omitted extensions', () => {
    it('treats extensions as an empty map by default', () => {
      expect(
        () =>
          new HttpServer({
            port: 0,
            oauth: mockOauth,
            mcp: mockMcp
          })
      ).not.toThrow()
    })
  })

  // Suppress unused-import noise from the vi.hoisted helpers.
  void mockTransport
  void mockExtractBearerToken
  void mockSendUnauthorized
})
