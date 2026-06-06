/**
 * PostgreSQL Token Store Adapter Tests (mocked pg)
 */

const { mockPool } = vi.hoisted(() => {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined)
  }

  return { mockPool }
})

vi.mock('#src/runtime/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

import { PostgresqlAdapter } from '../../../../src/oauth2/adapters/postgresql-adapter.js'

describe('PostgresqlAdapter', () => {
  let adapter

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 })

    adapter = new PostgresqlAdapter({ pool: mockPool })
  })

  const sampleTokens = {
    userId: 'user-123',
    accessToken: 'access-abc',
    refreshToken: 'refresh-xyz',
    expiresIn: 3600,
    scope: 'read write',
    mcpSessionId: 'session-001'
  }

  describe('constructor', () => {
    it('should use the injected pool', () => {
      expect(adapter.pool).toBe(mockPool)
    })
  })

  describe('init()', () => {
    it('should be a no-op (pool is managed externally)', async () => {
      await adapter.init()
      // No pool creation, no connectivity check
      expect(mockPool.query).not.toHaveBeenCalled()
    })
  })

  describe('storeTokens()', () => {
    it('should execute upsert query with correct params', async () => {
      await adapter.storeTokens(sampleTokens)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oauth_sessions'),
        expect.arrayContaining(['user-123', 'access-abc', 'refresh-xyz', 'read write'])
      )

      const [sql] = mockPool.query.mock.calls[0]
      expect(sql).toContain('$1')
      expect(sql).toContain('ON CONFLICT')
    })
  })

  describe('getTokens()', () => {
    it('should return null when no rows found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      const result = await adapter.getTokens('nonexistent')
      expect(result).toBeNull()
    })

    it('should return mapped token object', async () => {
      const expiresAt = new Date(Date.now() + 3600000)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            user_id: 'user-123',
            access_token: 'access-abc',
            refresh_token: 'refresh-xyz',
            scope: 'read write',
            expires_at: expiresAt,
            mcp_session_id: 'session-001'
          }
        ]
      })

      const result = await adapter.getTokens('user-123')

      expect(result).toEqual({
        userId: 'user-123',
        accessToken: 'access-abc',
        refreshToken: 'refresh-xyz',
        scope: 'read write',
        expiresAt: expiresAt.toISOString(),
        mcpSessionId: 'session-001',
        isExpired: false
      })
    })

    it('should mark expired tokens', async () => {
      const expiresAt = new Date(Date.now() - 1000)
      mockPool.query.mockResolvedValue({
        rows: [
          {
            user_id: 'u1',
            access_token: 'at',
            refresh_token: 'rt',
            scope: 'read',
            expires_at: expiresAt,
            mcp_session_id: 's1'
          }
        ]
      })

      const result = await adapter.getTokens('u1')
      expect(result.isExpired).toBe(true)
    })
  })

  describe('getTokensBySession()', () => {
    it('should query by mcp_session_id', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      await adapter.getTokensBySession('session-001')

      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('mcp_session_id'), [
        'session-001'
      ])
    })

    it('should return null for unknown session', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      const result = await adapter.getTokensBySession('unknown')
      expect(result).toBeNull()
    })
  })

  describe('deleteTokens()', () => {
    it('should delete by user_id', async () => {
      await adapter.deleteTokens('user-123')

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM oauth_sessions'),
        ['user-123']
      )
    })
  })

  describe('deleteExpiredTokens()', () => {
    it('should delete expired rows and return count', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 3 })

      const result = await adapter.deleteExpiredTokens()
      expect(result).toBe(3)
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('expires_at < NOW()'))
    })

    it('should return 0 when no expired tokens', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 0 })
      const result = await adapter.deleteExpiredTokens()
      expect(result).toBe(0)
    })
  })

  describe('close()', () => {
    it('should not call pool.end() (pool is managed externally)', async () => {
      await adapter.close()
      expect(mockPool.end).not.toHaveBeenCalled()
      expect(adapter.pool).toBeNull()
    })

    it('should be safe to call multiple times', async () => {
      await adapter.close()
      await adapter.close()
    })
  })

  describe('_ensurePool()', () => {
    it('should throw when pool is not set', async () => {
      await adapter.close()
      await expect(adapter.storeTokens(sampleTokens)).rejects.toThrow(
        'PostgreSQL adapter not initialized'
      )
    })
  })
})
