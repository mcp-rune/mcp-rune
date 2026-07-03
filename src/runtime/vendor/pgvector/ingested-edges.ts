/**
 * pgvector Ingested Edges — Store, Query, and Cleanup
 *
 * Implements the IngestedEdgesAdapter contract defined in
 * `src/runtime/vector-storage-definitions.ts`. Companion to ingested-records:
 * persists the relationship graph extracted during analysis_ingest so Phase 2
 * graph stratifiers and Phase 3 relationship summaries can join records by
 * edge type without scanning JSONB.
 */

import type { Pool } from 'pg'

import type {
  EdgePath,
  EdgePathStep,
  EdgeRow,
  FindPathsParams,
  StoreEdgesParams
} from '#src/runtime/vector-storage-definitions-ingested-edges.js'

/** Store a batch of edges. ON CONFLICT updates hop_depth to the shallower discovery. */
export async function storeEdges(
  pool: Pool,
  params: StoreEdgesParams,
  retentionDays: number
): Promise<number> {
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

/**
 * Shortest typed paths between two records in the session's edge graph.
 *
 * Traversal is undirected over the directed edges — the adjacency CTE unions
 * forward and reverse views, and each step reports the direction it used.
 * Cycle-safe via a per-path seen array. The recursive walk explores the full
 * frontier up to `maxDepth` before LIMIT applies (recursive CTEs cannot
 * early-stop under ORDER BY), which is fine at session scale: a session's
 * edge set is a bounded ingest, and depth is capped at 6.
 */
export async function findPaths(
  pool: Pool,
  analysisId: string,
  params: FindPathsParams
): Promise<EdgePath[]> {
  const maxDepth = Math.min(params.maxDepth ?? 4, 6)
  const limit = Math.min(params.limit ?? 5, 20)

  const result = await pool.query(
    `WITH RECURSIVE adj AS (
       SELECT src_model AS from_model, src_id AS from_id,
              dst_model AS to_model, dst_id AS to_id,
              edge_type, 'forward' AS direction
       FROM ingested_edges
       WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
       UNION ALL
       SELECT dst_model, dst_id, src_model, src_id, edge_type, 'reverse'
       FROM ingested_edges
       WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ),
     walk AS (
       SELECT $2::text AS node_model, $3::text AS node_id,
              '[]'::jsonb AS steps, 0 AS depth,
              ARRAY[$2::text || ':' || $3::text] AS seen
       UNION ALL
       SELECT a.to_model, a.to_id,
              w.steps || jsonb_build_object(
                'fromModel', a.from_model, 'fromId', a.from_id,
                'toModel', a.to_model, 'toId', a.to_id,
                'edgeType', a.edge_type, 'direction', a.direction
              ),
              w.depth + 1,
              w.seen || (a.to_model || ':' || a.to_id)
       FROM walk w
       JOIN adj a ON a.from_model = w.node_model AND a.from_id = w.node_id
       WHERE w.depth < $6 AND NOT ((a.to_model || ':' || a.to_id) = ANY(w.seen))
     )
     SELECT steps, depth FROM walk
     WHERE node_model = $4 AND node_id = $5 AND depth > 0
     ORDER BY depth ASC
     LIMIT $7`,
    [analysisId, params.from.model, params.from.id, params.to.model, params.to.id, maxDepth, limit]
  )

  return (result.rows as Array<{ steps: EdgePathStep[]; depth: number }>).map((row) => ({
    steps: row.steps,
    depth: row.depth
  }))
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
