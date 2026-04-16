/**
 * pgvector Vendor Implementation - SDK Lifecycle
 *
 * Manages pgvector vector storage via an injected PostgreSQL pool.
 * This module should only be imported by services/vector-storage.ts
 *
 * Pool injection only — never creates pools or reads env vars.
 * DDL is managed by scripts/db-migrate.js.
 */

import type { Pool } from 'pg'

import * as logger from '../../logger.js'
import * as operations from './tool-memories.js'

let pool: Pool | null = null

/** Check if pgvector is configured (pool injected) */
export function isConfigured(): boolean {
  return !!pool
}

/** Get the connection pool (for use by operations module) */
export function getPool(): Pool | null {
  return pool
}

export interface PgvectorOptions {
  pool?: Pool
  serviceName?: string
  version?: string
  retentionDays?: number
}

/**
 * Initialize pgvector with an injected connection pool
 */
export function initialize(options: PgvectorOptions = {}): boolean {
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
  operations.cleanupExpired(pool, retentionDays).catch((err: Error) => {
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

/** Flush pending writes (drain pool) */
export async function flush(_timeout = 5000): Promise<void> {
  // pg pool doesn't have a flush concept; this is a noop
  // Writes are synchronous from the pool's perspective
}

/**
 * Close the vector storage reference
 *
 * Nulls the pool reference but never calls pool.end() —
 * the pool is owned by src/engineer/db.js.
 */
export async function close(_timeout = 5000): Promise<void> {
  if (!pool) return

  pool = null
  logger.info('pgvector connection pool closed', { service: 'pgvector' })
}
