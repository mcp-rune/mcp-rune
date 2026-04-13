/**
 * Base Token Store Adapter
 *
 * Defines the interface that token store backends must implement.
 */

export interface StoreTokensParams {
  userId: string
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
  mcpSessionId: string
}

export interface TokenData {
  userId: string
  accessToken: string
  refreshToken: string
  scope: string
  expiresAt: string
  mcpSessionId: string
  isExpired: boolean
}

export abstract class BaseTokenStoreAdapter {
  /** Initialize the adapter (create tables, verify connectivity, etc.) */
  async init(): Promise<void> {
    throw new Error('Subclass must implement init()')
  }

  /** Store OAuth2 tokens for a user session */
  async storeTokens(_params: StoreTokensParams): Promise<void> {
    throw new Error('Subclass must implement storeTokens()')
  }

  /** Get tokens for a user */
  async getTokens(_userId: string): Promise<TokenData | null> {
    throw new Error('Subclass must implement getTokens()')
  }

  /** Get tokens by MCP session ID */
  async getTokensBySession(_mcpSessionId: string): Promise<TokenData | null> {
    throw new Error('Subclass must implement getTokensBySession()')
  }

  /** Delete tokens for a user */
  async deleteTokens(_userId: string): Promise<void> {
    throw new Error('Subclass must implement deleteTokens()')
  }

  /** Delete expired tokens (cleanup) */
  async deleteExpiredTokens(): Promise<number> {
    throw new Error('Subclass must implement deleteExpiredTokens()')
  }

  /** Close the adapter connection */
  async close(): Promise<void> {
    throw new Error('Subclass must implement close()')
  }
}
