import { createStatusRouter } from '../../../../src/mcp/middleware/status-router.js'

/** Locate an Express route handler on a Router by method + path. */
function findRouteHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method])
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  }
  return layer.route.stack[0].handle
}

describe('lib/mcp/middleware/status-router', () => {
  let mockRes
  beforeEach(() => {
    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis()
    }
  })

  describe('/health', () => {
    it('returns ok with service, transport, and activeSessions', () => {
      const router = createStatusRouter({
        serviceName: 'svc',
        getActiveSessions: () => 0
      })

      findRouteHandler(router, 'get', '/health')({}, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith({
        status: 'ok',
        service: 'svc',
        transport: 'streamable-http',
        activeSessions: 0
      })
    })

    it('reads active session count live via getActiveSessions', () => {
      let count = 0
      const router = createStatusRouter({
        serviceName: 'svc',
        getActiveSessions: () => count
      })
      const handler = findRouteHandler(router, 'get', '/health')

      count = 3
      handler({}, mockRes)
      expect(mockRes.json.mock.calls[0][0].activeSessions).toBe(3)

      count = 7
      handler({}, mockRes)
      expect(mockRes.json.mock.calls[1][0].activeSessions).toBe(7)
    })

    it('includes promptCache when the prompt registry exposes getStats', () => {
      const router = createStatusRouter({
        serviceName: 'svc',
        getActiveSessions: () => 0,
        promptRegistry: { getStats: () => ({ hits: 5, misses: 2 }) }
      })

      findRouteHandler(router, 'get', '/health')({}, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ promptCache: { hits: 5, misses: 2 } })
      )
    })

    it('omits promptCache when the registry has no getStats', () => {
      const router = createStatusRouter({
        serviceName: 'svc',
        getActiveSessions: () => 0,
        promptRegistry: {}
      })

      findRouteHandler(router, 'get', '/health')({}, mockRes)

      const payload = mockRes.json.mock.calls[0][0]
      expect(payload).not.toHaveProperty('promptCache')
    })
  })

  describe('/cache-stats', () => {
    it('returns service + cache when getStats is available', () => {
      const router = createStatusRouter({
        serviceName: 'svc',
        getActiveSessions: () => 0,
        promptRegistry: { getStats: () => ({ size: 12 }) }
      })

      findRouteHandler(router, 'get', '/cache-stats')({}, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith({ service: 'svc', cache: { size: 12 } })
    })

    it('is not registered at all when getStats is absent', () => {
      const router = createStatusRouter({
        serviceName: 'svc',
        getActiveSessions: () => 0
      })

      expect(() => findRouteHandler(router, 'get', '/cache-stats')).toThrow(/Route not found/)
    })
  })
})
