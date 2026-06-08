import * as logger from './logger.js'
import type { VectorStorageAdapter } from './vector-storage-definitions.js'
import {
  clearAdapter,
  clearCleanupInterval,
  getAdapter,
  getCleanupInterval,
  setAdapter,
  setCleanupInterval
} from './vector-storage-state.js'

export interface VectorStorageOptions {
  /**
   * Adapter implementing the `VectorStorageAdapter` contract. Without one,
   * vector storage stays disabled and every call becomes a no-op. Build the
   * adapter using a vendor factory (e.g. `createPgvectorAdapter({ pool })`)
   * — the facade is intentionally pool/vendor-blind.
   */
  adapter?: VectorStorageAdapter
  serviceName?: string
  version?: string
  /** When set, periodic cleanup across every sub-adapter fires on this interval (ms). */
  backgroundCleanupIntervalMs?: number
}

async function runCleanupSweep(): Promise<void> {
  const adapter = getAdapter()
  if (!adapter) return
  await Promise.all([
    adapter.toolMemories.cleanupExpired(),
    adapter.analysisMemories.cleanupExpired(),
    adapter.ingestedRecords.cleanupExpired(),
    adapter.ingestedEdges.cleanupExpired()
  ])
}

/**
 * Initialize vector storage. Call once at server startup with a constructed
 * adapter (e.g. `createPgvectorAdapter({ pool })`). No-op without one.
 */
export function initVectorStorage(options: VectorStorageOptions = {}): boolean {
  if (!options.adapter) {
    if (!process.env.VITEST) {
      logger.warn('vector-storage: no adapter provided, disabled', {
        service: 'vector-storage'
      })
    }
    return false
  }

  setAdapter(options.adapter)

  runCleanupSweep().catch((err: Error) => {
    logger.error('vector-storage boot cleanup failed', {
      service: 'vector-storage',
      error: err.message
    })
  })

  if (options.backgroundCleanupIntervalMs && options.backgroundCleanupIntervalMs > 0) {
    const interval = setInterval(() => {
      if (!getAdapter()) return
      runCleanupSweep().catch((err: Error) => {
        logger.error('vector-storage periodic cleanup failed', {
          service: 'vector-storage',
          error: err.message
        })
      })
    }, options.backgroundCleanupIntervalMs)
    if (typeof interval.unref === 'function') interval.unref()
    setCleanupInterval(interval)
  }

  logger.info('vector-storage initialized', {
    service: 'vector-storage',
    serviceName: options.serviceName,
    version: options.version,
    backgroundCleanupIntervalMs: options.backgroundCleanupIntervalMs ?? null
  })

  return true
}

/** Check if vector storage is configured and enabled */
export function isVectorStorageEnabled(): boolean {
  return getAdapter() !== null
}

/** Flush pending vector storage writes */
export async function flushVectorStorage(timeout = 5000): Promise<void> {
  const adapter = getAdapter()
  if (!adapter) return
  return adapter.flush(timeout)
}

/** Close vector storage service */
export async function closeVectorStorage(timeout = 5000): Promise<void> {
  const interval = getCleanupInterval()
  if (interval) {
    clearInterval(interval)
    clearCleanupInterval()
  }
  const adapter = getAdapter()
  if (!adapter) return
  clearAdapter()
  return adapter.close(timeout)
}
