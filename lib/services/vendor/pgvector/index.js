/**
 * pgvector Vendor Implementation - SDK Lifecycle
 *
 * Manages pgvector vector storage via an injected PostgreSQL pool.
 * This module should only be imported by lib/services/memory-storage.js
 *
 * Pool injection only — never creates pools or reads env vars.
 * DDL is managed by scripts/db-migrate.js.
 */

import * as logger from '../../logger.js'
import * as operations from './tool-memories.js'

let pool = null

/**
 * Check if pgvector is configured (pool injected)
 * @returns {boolean}
 */
export function isConfigured() {
  return !!pool
}

/**
 * Get the connection pool (for use by operations module)
 * @returns {pg.Pool|null}
 */
export function getPool() {
  return pool
}

/**
 * Initialize pgvector with an injected connection pool
 *
 * @param {Object} options - Configuration options
 * @param {import('pg').Pool} options.pool - Injected pool (required)
 * @param {string} options.serviceName - Name of the MCP server
 * @param {string} options.version - Server version
 * @param {number} [options.retentionDays=30] - Days to retain operation embeddings
 * @returns {boolean} True if initialized successfully
 */
export function initialize(options = {}) {
  if (!options.pool) {
    if (!process.env.VITEST) {
      logger.warn('pgvector: no pool provided, vector storage disabled', {
        service: 'pgvector'
      })
    }
    return false
  }

  pool = options.pool

  // Cleanup expired records asynchronously (don't block startup)
  const retentionDays = options.retentionDays || 30
  operations.cleanupExpired(pool, retentionDays).catch((err) => {
    logger.error('pgvector cleanup failed', {
      service: 'pgvector',
      error: err.message
    })
  })

  logger.info('pgvector initialized', {
    service: 'pgvector',
    serviceName: options.serviceName,
    version: options.version,
    retentionDays
  })

  return true
}

/**
 * Flush pending writes (drain pool)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function flush(_timeout = 5000) {
  // pg pool doesn't have a flush concept; this is a noop
  // Writes are synchronous from the pool's perspective
}

/**
 * Close the vector storage reference
 *
 * Nulls the pool reference but never calls pool.end() —
 * the pool is owned by src/engineer/db.js.
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function close(_timeout = 5000) {
  if (!pool) return

  pool = null
  logger.info('pgvector connection pool closed', { service: 'pgvector' })
}
