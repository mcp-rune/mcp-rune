/**
 * OAuth2 Token Manager Module
 *
 * Manages OAuth2 access tokens and refresh tokens with PostgreSQL persistence.
 *
 * Responsibilities:
 * - Store access tokens and refresh tokens per session
 * - Retrieve tokens for MCP requests
 * - Handle token expiration and refresh
 * - Provide token validation
 */

import { query } from '#lib/db/pg-client.js'
import { OAuth2Logger } from './logger.js'

/**
 * OAuth2 Token Manager
 * Handles token storage and retrieval using PostgreSQL
 */
export class OAuth2TokenManager {
  constructor(_dbConfig = {}, logger = null) {
    this.logger = logger || new OAuth2Logger()
    // PostgreSQL connection is managed globally by pg-client.js
    // _dbConfig is kept for interface compatibility but not used
    this.connected = false
  }

  /**
   * Connect to PostgreSQL
   * Must be called before using the token manager
   */
  async connect() {
    if (this.connected) {
      return
    }

    try {
      // Test PostgreSQL connection by executing a simple query
      const result = await query('SELECT 1 AS ok')
      if (result.rows) {
        this.connected = true
      }

      this.logger.info('TOKEN_STORAGE', 'Connected to PostgreSQL for token storage')
    } catch (error) {
      this.logger.error('TOKEN_STORAGE', 'Failed to connect to PostgreSQL', {
        error: error.message
      })
      throw new Error(`PostgreSQL connection failed: ${error.message}`, { cause: error })
    }
  }

  /**
   * Disconnect from PostgreSQL
   */
  async disconnect() {
    if (this.connected) {
      // Pool is managed externally — no explicit disconnect needed
      this.connected = false
      this.logger.info('TOKEN_STORAGE', 'Disconnected from PostgreSQL')
    }
  }

  /**
   * Store token information for a session
   *
   * Stores:
   * - access_token: The OAuth2 access token
   * - token_type: Token type (usually "Bearer")
   * - expires_at: Unix timestamp when token expires
   * - refresh_token: Refresh token (if available)
   * - scope: Granted scope
   *
   * @param {string} sessionId - MCP session identifier
   * @param {Object} tokenData - Token data to store
   * @param {string} tokenData.accessToken - Access token
   * @param {string} tokenData.tokenType - Token type
   * @param {number} tokenData.expiresIn - Expires in seconds
   * @param {string} tokenData.refreshToken - Refresh token (optional)
   * @param {string} tokenData.scope - Granted scope (optional)
   */
  async storeToken(sessionId, tokenData) {
    if (!this.connected) {
      throw new Error('Not connected to PostgreSQL')
    }

    const { accessToken, expiresIn, refreshToken, scope } = tokenData

    // Calculate expiration timestamp
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
    const now = new Date().toISOString()

    try {
      // Store in oauth_sessions table using mcp_session_id as the key
      // Note: user_id is not available at token storage time in reference implementation
      // We use a placeholder value for compatibility with the schema
      await query(
        `INSERT INTO oauth_sessions
          (user_id, access_token, refresh_token, scope, expires_at, mcp_session_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (mcp_session_id) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_sessions.refresh_token),
          scope = EXCLUDED.scope,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at`,
        [
          'oauth2-ref-user', // Placeholder user ID for reference implementation
          accessToken,
          refreshToken || null,
          scope || null,
          expiresAt,
          sessionId,
          now,
          now
        ]
      )

      this.logger.logTokenStorage(sessionId)

      this.logger.debug('TOKEN_STORAGE', `Token stored for session ${sessionId}`, {
        expiresIn,
        expiresAt: expiresAt ? expiresAt.toISOString() : 'never',
        hasRefreshToken: !!refreshToken
      })
    } catch (error) {
      this.logger.logTokenError(error)
      throw new Error(`Failed to store token: ${error.message}`, { cause: error })
    }
  }

  /**
   * Retrieve token information for a session
   *
   * @param {string} sessionId - MCP session identifier
   * @returns {Object|null} Token data or null if not found
   */
  async getToken(sessionId) {
    if (!this.connected) {
      throw new Error('Not connected to PostgreSQL')
    }

    try {
      const { rows } = await query(
        `SELECT access_token, refresh_token, scope, expires_at, created_at, updated_at
        FROM oauth_sessions
        WHERE mcp_session_id = $1
        LIMIT 1`,
        [sessionId]
      )

      if (rows.length === 0) {
        this.logger.logTokenRetrieval(sessionId, false)
        return null
      }

      const row = rows[0]
      this.logger.logTokenRetrieval(sessionId, true)

      return {
        accessToken: row.access_token,
        tokenType: 'Bearer',
        expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
        refreshToken: row.refresh_token,
        scope: row.scope,
        storedAt: new Date(row.created_at).getTime()
      }
    } catch (error) {
      this.logger.logTokenError(error)
      throw new Error(`Failed to retrieve token: ${error.message}`, { cause: error })
    }
  }

  /**
   * Check if token is expired
   *
   * @param {Object} tokenData - Token data from getToken()
   * @returns {boolean} True if token is expired
   */
  isTokenExpired(tokenData) {
    if (!tokenData || !tokenData.expiresAt) {
      return false // No expiration set, assume valid
    }

    // Add 60 second buffer to prevent edge cases
    const isExpired = Date.now() >= tokenData.expiresAt - 60000

    if (isExpired) {
      this.logger.logTokenValidation(false)
    } else {
      this.logger.logTokenValidation(true)
    }

    return isExpired
  }

  /**
   * Get valid access token for a session
   * Returns null if token is expired and no refresh token available
   *
   * @param {string} sessionId - MCP session identifier
   * @returns {Object|null} Token data with validity info
   */
  async getValidToken(sessionId) {
    const tokenData = await this.getToken(sessionId)

    if (!tokenData) {
      return null
    }

    const isExpired = this.isTokenExpired(tokenData)

    return {
      ...tokenData,
      isExpired,
      needsRefresh: isExpired && !!tokenData.refreshToken
    }
  }

  /**
   * Delete token for a session
   *
   * @param {string} sessionId - MCP session identifier
   */
  async deleteToken(sessionId) {
    if (!this.connected) {
      throw new Error('Not connected to PostgreSQL')
    }

    try {
      await query(`DELETE FROM oauth_sessions WHERE mcp_session_id = $1`, [sessionId])
      this.logger.info('TOKEN_STORAGE', `Token deleted for session ${sessionId}`)
    } catch (error) {
      this.logger.logTokenError(error)
      throw new Error(`Failed to delete token: ${error.message}`, { cause: error })
    }
  }

  /**
   * Update access token (after refresh)
   * Preserves refresh token if new one is not provided
   *
   * @param {string} sessionId - MCP session identifier
   * @param {Object} newTokenData - New token data
   */
  async updateToken(sessionId, newTokenData) {
    const existingToken = await this.getToken(sessionId)

    // Merge with existing data, preserving refresh token if not updated
    const mergedTokenData = {
      ...newTokenData,
      refreshToken: newTokenData.refreshToken || existingToken?.refreshToken
    }

    await this.storeToken(sessionId, mergedTokenData)

    this.logger.info('TOKEN_STORAGE', `Token updated for session ${sessionId}`)
  }

  /**
   * Get all session IDs with stored tokens
   * Useful for cleanup or monitoring
   *
   * @returns {Array<string>} Array of session IDs
   */
  async getAllSessions() {
    if (!this.connected) {
      throw new Error('Not connected to PostgreSQL')
    }

    try {
      const { rows } = await query(
        `SELECT DISTINCT mcp_session_id
        FROM oauth_sessions
        WHERE mcp_session_id IS NOT NULL`
      )

      const sessionIds = rows.map((row) => row.mcp_session_id)

      return sessionIds
    } catch (error) {
      this.logger.logTokenError(error)
      throw new Error(`Failed to get sessions: ${error.message}`, { cause: error })
    }
  }

  /**
   * Clean up expired tokens
   *
   * @returns {number} Number of tokens cleaned up
   */
  async cleanupExpiredTokens() {
    if (!this.connected) {
      throw new Error('Not connected to PostgreSQL')
    }

    try {
      const { rowCount } = await query(
        `DELETE FROM oauth_sessions
        WHERE expires_at < NOW() AND mcp_session_id LIKE 'oauth2-ref-%'`
      )

      const cleanedCount = rowCount || 0

      if (cleanedCount > 0) {
        this.logger.info('TOKEN_STORAGE', `Cleaned up ${cleanedCount} expired tokens`)
      }

      return cleanedCount
    } catch (error) {
      this.logger.logTokenError(error)
      throw new Error(`Token cleanup failed: ${error.message}`, { cause: error })
    }
  }
}
