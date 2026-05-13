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
import * as analysisMemories from './analysis-memories.js'
import * as ingestedRecords from './ingested-records.js'
import * as operations from './tool-memories.js'

let pool: Pool | null = null
let cleanupInterval: ReturnType<typeof setInterval> | null = null

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
  /** Retention for tool_memories (operations feature). Default 30 days. */
  retentionDays?: number
  /** Retention for ingested_records (analysis feature). Default 7 days. */
  ingestedRecordsRetentionDays?: number
  /**
   * If set, run cleanup across all three tables every N ms. Default off so
   * tests and short-lived processes aren't affected. setInterval's native
   * unit is ms; sub-minute intervals are useful for tests.
   */
  backgroundCleanupIntervalMs?: number
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

  const retentionDays = options.retentionDays || 30
  const ingestedRetention = options.ingestedRecordsRetentionDays ?? 7
  ingestedRecords.setRetentionDays(ingestedRetention)

  // Boot-time sweep across all three tables (async, non-blocking).
  runCleanupSweep(pool, retentionDays).catch((err: Error) => {
    logger.error('pgvector boot cleanup failed', {
      service: 'pgvector',
      error: err.message
    })
  })

  if (options.backgroundCleanupIntervalMs && options.backgroundCleanupIntervalMs > 0) {
    cleanupInterval = setInterval(() => {
      const currentPool = pool
      if (!currentPool) return
      runCleanupSweep(currentPool, retentionDays).catch((err: Error) => {
        logger.error('pgvector periodic cleanup failed', {
          service: 'pgvector',
          error: err.message
        })
      })
    }, options.backgroundCleanupIntervalMs)
    if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref()
  }

  logger.info('pgvector initialized', {
    service: 'pgvector',
    serviceName: options.serviceName,
    version: options.version,
    retentionDays,
    ingestedRecordsRetentionDays: ingestedRetention,
    backgroundCleanupIntervalMs: options.backgroundCleanupIntervalMs ?? null
  })

  return true
}

async function runCleanupSweep(p: Pool, toolMemoriesRetentionDays: number): Promise<void> {
  await Promise.all([
    operations.cleanupExpired(p, toolMemoriesRetentionDays),
    ingestedRecords.cleanupExpired(p),
    analysisMemories.cleanupExpired(p)
  ])
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
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
  if (!pool) return

  pool = null
  logger.info('pgvector connection pool closed', { service: 'pgvector' })
}
