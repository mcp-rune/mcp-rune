/**
 * pgvector Ingested Edges — Store, Query, and Cleanup
 *
 * Companion to ingested-records.ts. Persists the relationship graph
 * extracted during analysis_ingest so Phase 2 graph stratifiers and
 * Phase 3 relationship summaries can join records by edge type without
 * scanning JSONB.
 */

import type { Pool } from 'pg'

import type { Edge } from '#src/core/edge-extraction.js'

export interface StoreEdgesParams {
  analysisId: string
  edges: ReadonlyArray<Edge>
  hopDepth?: number
}

let retentionDays = 7

/** Configure how long newly-stored edges survive before eviction. */
export function setRetentionDays(days: number): void {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid retentionDays: ${days}. Must be a positive number.`)
  }
  retentionDays = days
}

/** Store a batch of edges. ON CONFLICT updates hop_depth to the shallower discovery. */
export async function storeEdges(pool: Pool, params: StoreEdgesParams): Promise<number> {
  if (params.edges.length === 0) return 0

  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000)
  const hopDepth = params.hopDepth ?? 0

  const values: unknown[] = []
  const placeholders: string[] = []
  let paramIdx = 1

  for (const edge of params.edges) {
    placeholders.push(
      `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
    )
    values.push(
      params.analysisId,
      edge.src_model,
      edge.src_id,
      edge.dst_model,
      edge.dst_id,
      edge.edge_type,
      hopDepth,
      expiresAt
    )
  }

  await pool.query(
    `INSERT INTO ingested_edges
       (analysis_id, src_model, src_id, dst_model, dst_id, edge_type, hop_depth, expires_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (analysis_id, src_model, src_id, dst_model, dst_id, edge_type)
     DO UPDATE SET
       hop_depth = LEAST(ingested_edges.hop_depth, EXCLUDED.hop_depth),
       expires_at = EXCLUDED.expires_at`,
    values
  )

  return params.edges.length
}

export interface EdgeRow {
  src_model: string
  src_id: string
  dst_model: string
  dst_id: string
  edge_type: string
  hop_depth: number
}

/** Edges originating from a given (model, id) within a session. */
export async function getEdgesFrom(
  pool: Pool,
  analysisId: string,
  srcModel: string,
  srcId: string
): Promise<EdgeRow[]> {
  const result = await pool.query(
    `SELECT src_model, src_id, dst_model, dst_id, edge_type, hop_depth
     FROM ingested_edges
     WHERE analysis_id = $1 AND src_model = $2 AND src_id = $3
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [analysisId, srcModel, srcId]
  )
  return result.rows as EdgeRow[]
}

/** Edges pointing into a given (model, id) within a session. */
export async function getEdgesTo(
  pool: Pool,
  analysisId: string,
  dstModel: string,
  dstId: string
): Promise<EdgeRow[]> {
  const result = await pool.query(
    `SELECT src_model, src_id, dst_model, dst_id, edge_type, hop_depth
     FROM ingested_edges
     WHERE analysis_id = $1 AND dst_model = $2 AND dst_id = $3
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [analysisId, dstModel, dstId]
  )
  return result.rows as EdgeRow[]
}

/**
 * Edges for a set of source records of a given model — used to bulk-load
 * per-page edges for relationship-coverage and concept-touch strategies.
 */
export async function getEdgesForSources(
  pool: Pool,
  analysisId: string,
  srcModel: string,
  srcIds: ReadonlyArray<string>
): Promise<EdgeRow[]> {
  if (srcIds.length === 0) return []
  const result = await pool.query(
    `SELECT src_model, src_id, dst_model, dst_id, edge_type, hop_depth
     FROM ingested_edges
     WHERE analysis_id = $1 AND src_model = $2
       AND src_id = ANY($3::text[])
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [analysisId, srcModel, srcIds as string[]]
  )
  return result.rows as EdgeRow[]
}

/** Clear all edges for an analysis session. */
export async function clearEdges(pool: Pool, analysisId: string): Promise<number> {
  const result = await pool.query(`DELETE FROM ingested_edges WHERE analysis_id = $1`, [analysisId])
  return result.rowCount ?? 0
}

/** Delete expired edges (on-access eviction). */
export async function cleanupExpired(pool: Pool): Promise<number> {
  const result = await pool.query(`DELETE FROM ingested_edges WHERE expires_at < NOW()`)
  return result.rowCount ?? 0
}
