/**
 * PostgreSQL Client
 *
 * Thin query wrapper over an injected pg.Pool.
 * Provides the same `query(sql, params)` interface as the former mysql-client.js,
 * so consumers (e.g. oauth2-ref) can swap with a single import change.
 *
 * The pool is set at startup via `setPool()` — no process.env reads here.
 */

import * as logger from '#lib/services/logger.js'

let pool = null

/**
 * Inject the shared pg.Pool (called once at startup).
 * @param {import('pg').Pool} p
 */
export function setPool(p) {
  pool = p
}

/**
 * Execute a parameterised query.
 *
 * @param {string} sql  - SQL with $1, $2, … placeholders
 * @param {Array}  params
 * @returns {Promise<import('pg').QueryResult>} Full pg result (rows, rowCount, …)
 */
export async function query(sql, params = []) {
  if (!pool) {
    throw new Error('pg-client: pool not initialised — call setPool() first')
  }

  try {
    return await pool.query(sql, params)
  } catch (err) {
    logger.error('PostgreSQL query error', {
      service: 'pg-client',
      sql: sql.substring(0, 100),
      error: err.message
    })
    throw err
  }
}

/**
 * Get the underlying pool (for callers that need transactions, etc.).
 * @returns {import('pg').Pool|null}
 */
export function getPool() {
  return pool
}
