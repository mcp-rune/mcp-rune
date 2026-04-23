import { LoggingApiClient } from '../../../../src/mcp/tools/logging-api-client.js'

describe('LoggingApiClient', () => {
  let inner: Record<string, ReturnType<typeof vi.fn>> & { baseUrl?: string }
  let logger: Record<string, ReturnType<typeof vi.fn>>
  let client: LoggingApiClient

  beforeEach(() => {
    inner = {
      baseUrl: 'https://api.example.com',
      get: vi.fn().mockResolvedValue({ id: 1, name: 'test' }),
      post: vi.fn().mockResolvedValue({ created: true }),
      put: vi.fn().mockResolvedValue({ updated: true }),
      patch: vi.fn().mockResolvedValue({ patched: true }),
      delete: vi.fn().mockResolvedValue({ deleted: true })
    }
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    client = new LoggingApiClient(inner as never, logger as never)
  })

  // ============================================================================
  // Delegation
  // ============================================================================

  it('should delegate get() and return the result unchanged', async () => {
    const result = await client.get('/users', { page: 1 })
    expect(inner.get).toHaveBeenCalledWith('/users', { page: 1 }, undefined)
    expect(result).toEqual({ id: 1, name: 'test' })
  })

  it('should delegate post() and return the result unchanged', async () => {
    const result = await client.post('/users', { name: 'new' })
    expect(inner.post).toHaveBeenCalledWith('/users', { name: 'new' }, undefined)
    expect(result).toEqual({ created: true })
  })

  it('should delegate put() and return the result unchanged', async () => {
    const result = await client.put('/users/1', { name: 'updated' })
    expect(inner.put).toHaveBeenCalledWith('/users/1', { name: 'updated' }, undefined)
    expect(result).toEqual({ updated: true })
  })

  it('should delegate patch() and return the result unchanged', async () => {
    const result = await client.patch('/users/1', { name: 'patched' })
    expect(inner.patch).toHaveBeenCalledWith('/users/1', { name: 'patched' }, undefined)
    expect(result).toEqual({ patched: true })
  })

  it('should delegate delete() and return the result unchanged', async () => {
    const result = await client.delete('/users/1')
    expect(inner.delete).toHaveBeenCalledWith('/users/1', undefined)
    expect(result).toEqual({ deleted: true })
  })

  // ============================================================================
  // Request logging
  // ============================================================================

  it('should log GET request with url and params', async () => {
    await client.get('/items', { status: 'active' })

    const reqLog = logger.debug.mock.calls.find((c) => c[0] === '[API Request] GET')
    expect(reqLog).toBeDefined()
    expect(reqLog[1]).toEqual({ url: '/items', params: { status: 'active' } })
  })

  it('should log POST request with url and body', async () => {
    await client.post('/search', { query: 'test', filters: { type: 'a' } })

    const reqLog = logger.debug.mock.calls.find((c) => c[0] === '[API Request] POST')
    expect(reqLog).toBeDefined()
    expect(reqLog[1].url).toBe('/search')
    expect(reqLog[1].body).toContain('test')
  })

  // ============================================================================
  // Response logging
  // ============================================================================

  it('should log GET response with url and body summary', async () => {
    await client.get('/items')

    const resLog = logger.debug.mock.calls.find((c) => c[0] === '[API Response] GET')
    expect(resLog).toBeDefined()
    expect(resLog[1].url).toBe('/items')
    expect(resLog[1].body).toContain('"id":1')
  })

  // ============================================================================
  // Truncation
  // ============================================================================

  it('should truncate large responses', async () => {
    const largeObj: Record<string, string> = {}
    for (let i = 0; i < 500; i++) {
      largeObj[`key_${i}`] = 'x'.repeat(20)
    }
    inner.get.mockResolvedValueOnce(largeObj)

    await client.get('/large')

    const resLog = logger.debug.mock.calls.find((c) => c[0] === '[API Response] GET')
    expect(resLog[1].body).toContain('...[truncated]')
    expect(resLog[1].body.length).toBeLessThanOrEqual(2100) // MAX_LOG_LENGTH + suffix
  })

  it('should summarize array responses with count and first element', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` }))
    inner.get.mockResolvedValueOnce(items)

    await client.get('/items')

    const resLog = logger.debug.mock.calls.find((c) => c[0] === '[API Response] GET')
    expect(resLog[1].body).toContain('Array(100)')
    expect(resLog[1].body).toContain('"id":0')
  })

  // ============================================================================
  // Extra arguments forwarding
  // ============================================================================

  it('should forward extra arguments to the inner client', async () => {
    const extraOpts = { userId: 'user-123' }
    await client.get('/items', { page: 1 }, extraOpts)

    expect(inner.get).toHaveBeenCalledWith('/items', { page: 1 }, extraOpts)
  })

  it('should forward extra arguments for post()', async () => {
    await client.post('/items', { name: 'test' }, { headers: { 'X-Custom': '1' } })

    expect(inner.post).toHaveBeenCalledWith(
      '/items',
      { name: 'test' },
      {
        headers: { 'X-Custom': '1' }
      }
    )
  })

  // ============================================================================
  // baseUrl passthrough
  // ============================================================================

  it('should expose the inner client baseUrl', () => {
    expect(client.baseUrl).toBe('https://api.example.com')
  })

  it('should return undefined when inner client has no baseUrl', () => {
    const noUrlInner = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn()
    }
    const c = new LoggingApiClient(noUrlInner as never, logger as never)
    expect(c.baseUrl).toBeUndefined()
  })

  // ============================================================================
  // Error propagation
  // ============================================================================

  it('should propagate errors from the inner client', async () => {
    inner.get.mockRejectedValueOnce(new Error('Network error'))

    await expect(client.get('/failing')).rejects.toThrow('Network error')

    // Should still have logged the request
    const reqLog = logger.debug.mock.calls.find((c) => c[0] === '[API Request] GET')
    expect(reqLog).toBeDefined()
  })

  // ============================================================================
  // Edge cases
  // ============================================================================

  it('should handle null and undefined responses', async () => {
    inner.get.mockResolvedValueOnce(null)
    await client.get('/null')

    const resLog = logger.debug.mock.calls.find((c) => c[0] === '[API Response] GET')
    expect(resLog[1].body).toBe('null')
  })

  it('should handle undefined params gracefully', async () => {
    await client.get('/no-params')

    const reqLog = logger.debug.mock.calls.find((c) => c[0] === '[API Request] GET')
    expect(reqLog[1]).toEqual({ url: '/no-params', params: undefined })
  })
})
