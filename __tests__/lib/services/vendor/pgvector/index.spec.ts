
// Mock logger to prevent console output during tests
vi.mock('../../../../../src/services/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Mock tool-memories to prevent real DB calls
vi.mock('../../../../../src/services/vendor/pgvector/tool-memories.js', () => ({
  cleanupExpired: vi.fn(() => Promise.resolve(0))
}))

// Must import after mocks
const pgvectorModule = await import('../../../../../src/services/vendor/pgvector/index.js')
const { isConfigured, initialize, close, getPool } = pgvectorModule

describe('lib/services/vendor/pgvector/index', () => {
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset state between tests
    await close()
  })

  describe('isConfigured', () => {
    it('should return false when no pool is set', () => {
      expect(isConfigured()).toBe(false)
    })

    it('should return true after pool injection', () => {
      initialize({ pool: mockPool, serviceName: 'test' })

      expect(isConfigured()).toBe(true)
    })
  })

  describe('initialize', () => {
    it('should return false when no pool provided', () => {
      const result = initialize({ serviceName: 'test' })

      expect(result).toBe(false)
      expect(isConfigured()).toBe(false)
    })

    it('should return true with injected pool', () => {
      const result = initialize({ pool: mockPool, serviceName: 'test', version: '1.0.0' })

      expect(result).toBe(true)
      expect(isConfigured()).toBe(true)
      expect(getPool()).toBe(mockPool)
    })

    it('should run async cleanup on init', async () => {
      const { cleanupExpired } =
        await import('../../../../../src/services/vendor/pgvector/tool-memories.js')

      initialize({ pool: mockPool, serviceName: 'test', retentionDays: 14 })

      // cleanupExpired is called asynchronously
      await vi.waitFor(() => {
        expect(cleanupExpired).toHaveBeenCalledWith(mockPool, 14)
      })
    })
  })

  describe('close', () => {
    it('should null the pool reference', async () => {
      initialize({ pool: mockPool, serviceName: 'test' })
      expect(getPool()).toBe(mockPool)

      await close()

      expect(getPool()).toBeNull()
      expect(isConfigured()).toBe(false)
    })

    it('should be a no-op when already closed', async () => {
      await close() // no error
      expect(isConfigured()).toBe(false)
    })
  })
})
