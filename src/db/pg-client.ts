/**
 * PostgreSQL Client
 *
 * Thin query wrapper over an injected pg.Pool.
 * Provides the same `query(sql, params)` interface as the former mysql-client.js,
 * so consumers (e.g. oauth2-ref) can swap with a single import change.
 *
 * The pool is set at startup via `setPool()` — no process.env reads here.
 */

import type { Pool, QueryResult } from 'pg'

import * as logger from '#src/runtime/logger.js'

let pool: Pool | null = null

/** Inject the shared pg.Pool (called once at startup). */
export function setPool(p: Pool): void {
  pool = p
}

/**
 * Execute a parameterised query.
 */
export async function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
  if (!pool) {
    throw new Error('pg-client: pool not initialised — call setPool() first')
  }

  try {
    return await pool.query(sql, params)
  } catch (err) {
    logger.error('PostgreSQL query error', {
      service: 'pg-client',
      sql: sql.substring(0, 100),
      error: (err as Error).message
    })
    throw err
  }
}

/** Get the underlying pool (for callers that need transactions, etc.). */
export function getPool(): Pool | null {
  return pool
}
