/**
 * pgvector Adapter Factory
 *
 * Bundles the four pgvector impl modules into a single object that satisfies
 * `VectorStorageAdapter` (see `src/runtime/vector-storage-definitions.ts`).
 * The pool and per-table retention windows are bound at construction; the
 * returned object is opaque to the facade — it just calls methods.
 *
 * The integrator owns the pool's lifecycle: this factory never creates pools,
 * never reads env vars, never calls `pool.end()`. DDL is managed separately
 * by `scripts/db-migrate.js`.
 */

import type { Pool } from 'pg'

import type { VectorStorageAdapter } from '#src/runtime/vector-storage-definitions.js'

import * as analysisMemories from './analysis-memories.js'
import * as ingestedEdges from './ingested-edges.js'
import * as ingestedRecords from './ingested-records.js'
import * as toolMemories from './tool-memories.js'

export interface PgvectorAdapterOptions {
  /** Postgres pool. Lifecycle stays with the integrator. */
  pool: Pool
  /** Retention for tool_memories. Default 30 days. */
  toolMemoriesRetentionDays?: number
  /** Retention for ingested_records. Default 7 days. */
  ingestedRecordsRetentionDays?: number
  /** Retention for ingested_edges. Defaults to ingestedRecordsRetentionDays. */
  ingestedEdgesRetentionDays?: number
}

/**
 * Build a `VectorStorageAdapter` backed by Postgres + pgvector.
 *
 * @example
 * import { createPgvectorAdapter } from '@mcp-rune/mcp-rune/runtime/vendor/pgvector'
 * import { initVectorStorage } from '@mcp-rune/mcp-rune/runtime'
 *
 * initVectorStorage({
 *   adapter: createPgvectorAdapter({ pool }),
 *   backgroundCleanupIntervalMs: 60_000
 * })
 */
export function createPgvectorAdapter(options: PgvectorAdapterOptions): VectorStorageAdapter {
  const { pool } = options
  const toolRetention = options.toolMemoriesRetentionDays ?? 30
  const recordsRetention = options.ingestedRecordsRetentionDays ?? 7
  const edgesRetention = options.ingestedEdgesRetentionDays ?? recordsRetention

  return {
    toolMemories: {
      storeOperation: (embedding, metadata) =>
        toolMemories.storeOperation(pool, embedding, metadata),
      findSimilar: (embedding, filters, options) =>
        toolMemories.findSimilar(pool, embedding, filters, options),
      detectGaps: (templateEmbeddings, filters, options) =>
        toolMemories.detectGaps(pool, templateEmbeddings, filters, options),
      getClusters: (filters, options) => toolMemories.getClusters(pool, filters, options),
      getStats: (filters) => toolMemories.getStats(pool, filters),
      cleanupExpired: () => toolMemories.cleanupExpired(pool, toolRetention)
    },
    analysisMemories: {
      storeMemory: (embedding, metadata) => analysisMemories.storeMemory(pool, embedding, metadata),
      recallMemories: (filters, options) => analysisMemories.recallMemories(pool, filters, options),
      clearMemories: (analysisId) => analysisMemories.clearMemories(pool, analysisId),
      cleanupExpired: () => analysisMemories.cleanupExpired(pool)
    },
    ingestedRecords: {
      storeRecords: (params) => ingestedRecords.storeRecords(pool, params, recordsRetention),
      queryRecords: (analysisId, query) => ingestedRecords.queryRecords(pool, analysisId, query),
      getEmbeddingsForRecords: (analysisId, model, recordIds) =>
        ingestedRecords.getEmbeddingsForRecords(pool, analysisId, model, recordIds),
      getRecordsWithoutEmbeddings: (analysisId, model, limit) =>
        ingestedRecords.getRecordsWithoutEmbeddings(pool, analysisId, model, limit),
      updateRecordEmbeddings: (analysisId, model, updates) =>
        ingestedRecords.updateRecordEmbeddings(pool, analysisId, model, updates),
      getSessionGraphInfo: (analysisId) => ingestedRecords.getSessionGraphInfo(pool, analysisId),
      describeSession: (analysisId) => ingestedRecords.describeSession(pool, analysisId),
      getRecordCount: (analysisId, model) =>
        ingestedRecords.getRecordCount(pool, analysisId, model),
      getRecordIds: (analysisId, model) => ingestedRecords.getRecordIds(pool, analysisId, model),
      getRecordIdsFiltered: (analysisId, model, where) =>
        ingestedRecords.getRecordIdsFiltered(pool, analysisId, model, where),
      getRecordsForDryRun: (analysisId, model, where, sampleLimit) =>
        ingestedRecords.getRecordsForDryRun(pool, analysisId, model, where, sampleLimit),
      clearRecords: (analysisId) => ingestedRecords.clearRecords(pool, analysisId),
      cleanupExpired: () => ingestedRecords.cleanupExpired(pool)
    },
    ingestedEdges: {
      storeEdges: (params) => ingestedEdges.storeEdges(pool, params, edgesRetention),
      getEdgesFrom: (analysisId, srcModel, srcId) =>
        ingestedEdges.getEdgesFrom(pool, analysisId, srcModel, srcId),
      getEdgesForSources: (analysisId, srcModel, srcIds) =>
        ingestedEdges.getEdgesForSources(pool, analysisId, srcModel, srcIds),
      clearEdges: (analysisId) => ingestedEdges.clearEdges(pool, analysisId),
      cleanupExpired: () => ingestedEdges.cleanupExpired(pool)
    },
    async flush() {
      // pg pool has no flush concept; writes are synchronous from the pool's perspective.
    },
    async close() {
      // The pool's lifecycle is owned by the integrator. Nothing to release here.
    }
  }
}
