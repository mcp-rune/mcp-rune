/**
 * Base Token Store Adapter
 *
 * Defines the interface that token store backends must implement.
 */
export class BaseTokenStoreAdapter {
  /**
   * Initialize the adapter (create tables, verify connectivity, etc.)
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('Subclass must implement init()')
  }

  /**
   * Store OAuth2 tokens for a user session
   * @param {Object} _params
   * @param {string} _params.userId - User ID
   * @param {string} _params.accessToken - OAuth2 access token
   * @param {string} _params.refreshToken - OAuth2 refresh token
   * @param {number} _params.expiresIn - Token expiry in seconds
   * @param {string} _params.scope - Token scopes
   * @param {string} _params.mcpSessionId - MCP session identifier
   * @returns {Promise<void>}
   */
  async storeTokens(_params) {
    throw new Error('Subclass must implement storeTokens()')
  }

  /**
   * Get tokens for a user
   * @param {string} _userId - User ID
   * @returns {Promise<Object|null>} Token data or null
   */
  async getTokens(_userId) {
    throw new Error('Subclass must implement getTokens()')
  }

  /**
   * Get tokens by MCP session ID
   * @param {string} _mcpSessionId - MCP session identifier
   * @returns {Promise<Object|null>} Token data or null
   */
  async getTokensBySession(_mcpSessionId) {
    throw new Error('Subclass must implement getTokensBySession()')
  }

  /**
   * Delete tokens for a user
   * @param {string} _userId - User ID
   * @returns {Promise<void>}
   */
  async deleteTokens(_userId) {
    throw new Error('Subclass must implement deleteTokens()')
  }

  /**
   * Delete expired tokens (cleanup)
   * @returns {Promise<number>} Number of deleted rows
   */
  async deleteExpiredTokens() {
    throw new Error('Subclass must implement deleteExpiredTokens()')
  }

  /**
   * Close the adapter connection
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Subclass must implement close()')
  }
}
