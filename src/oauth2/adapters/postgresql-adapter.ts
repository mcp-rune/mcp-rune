/**
 * PostgreSQL Token Store Adapter
 *
 * Stores OAuth2 tokens in PostgreSQL via an injected connection pool.
 * The pool is shared with pgvector storage (single database).
 *
 * Tables must be created before use via: npm run db:migrate
 */

import type { Pool } from 'pg'
import * as logger from '#src/services/logger.js'
import type { StoreTokensParams, TokenData } from './base-adapter.js'
import { BaseTokenStoreAdapter } from './base-adapter.js'

interface TokenRow {
  user_id: string
  access_token: string
  refresh_token: string
  scope: string
  expires_at: string | Date
  mcp_session_id: string
}

export class PostgresqlAdapter extends BaseTokenStoreAdapter {
  pool: Pool | null

  constructor({ pool }: { pool: Pool }) {
    super()
    this.pool = pool
  }

  async init(): Promise<void> {
    // No-op: pool is managed externally by src/engineer/db.js
  }

  async storeTokens({ userId, accessToken, refreshToken, expiresIn, scope, mcpSessionId }: StoreTokensParams): Promise<void> {
    this._ensurePool()

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
    const now = new Date().toISOString()

    await this.pool!.query(
      `INSERT INTO oauth_sessions
        (user_id, access_token, refresh_token, scope, expires_at, mcp_session_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (mcp_session_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_sessions.refresh_token),
        scope = EXCLUDED.scope,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at`,
      [userId, accessToken, refreshToken, scope, expiresAt, mcpSessionId, now, now]
    )

    logger.info('Tokens stored', { service: 'oauth2', userId, expiresAt })
  }

  async getTokens(userId: string): Promise<TokenData | null> {
    this._ensurePool()

    const { rows } = await this.pool!.query(
      `SELECT user_id, access_token, refresh_token,
        scope, expires_at, mcp_session_id
      FROM oauth_sessions
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
      [userId]
    )

    if (rows.length === 0) return null

    return this._rowToTokens(rows[0] as TokenRow)
  }

  async getTokensBySession(mcpSessionId: string): Promise<TokenData | null> {
    this._ensurePool()

    const { rows } = await this.pool!.query(
      `SELECT user_id, access_token, refresh_token,
        scope, expires_at, mcp_session_id
      FROM oauth_sessions
      WHERE mcp_session_id = $1
      LIMIT 1`,
      [mcpSessionId]
    )

    if (rows.length === 0) return null

    return this._rowToTokens(rows[0] as TokenRow)
  }

  async deleteTokens(userId: string): Promise<void> {
    this._ensurePool()

    await this.pool!.query(`DELETE FROM oauth_sessions WHERE user_id = $1`, [userId])

    logger.info('Tokens deleted', { service: 'oauth2', userId })
  }

  async deleteExpiredTokens(): Promise<number> {
    this._ensurePool()

    const { rowCount } = await this.pool!.query(
      `DELETE FROM oauth_sessions WHERE expires_at < NOW()`
    )

    if (rowCount! > 0) {
      logger.info('Expired tokens cleaned up', { service: 'oauth2', count: rowCount })
    }

    return rowCount!
  }

  async close(): Promise<void> {
    // Pool is managed externally -- never end it here
    this.pool = null
  }

  private _ensurePool(): void {
    if (!this.pool) {
      throw new Error('PostgreSQL adapter not initialized. Call init() first.')
    }
  }

  private _rowToTokens(row: TokenRow): TokenData {
    return {
      userId: row.user_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      scope: row.scope,
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      mcpSessionId: row.mcp_session_id,
      isExpired: new Date(row.expires_at) < new Date()
    }
  }
}
