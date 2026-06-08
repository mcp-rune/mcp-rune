/**
 * pgvector Tool Memories - Store, Query, and Cleanup
 *
 * Implements the ToolMemoriesAdapter contract defined in
 * `src/runtime/vector-storage-definitions.ts`. All functions receive the pg
 * pool as the first argument; the adapter factory in `./index.ts` binds it.
 */

import type { Pool } from 'pg'

import type {
  ClusterFilters,
  ClusterOptions,
  ClusterResult,
  GapFilters,
  GapOptions,
  GapResult,
  OperationFilters,
  OperationMetadata,
  QueryOptions,
  TemplateEmbedding
} from '#src/runtime/vector-storage-definitions-tool-memories.js'

import { cosineSimilarity } from '../../cosine-similarity.js'

interface ClusterEntry {
  representative: string
  toolName: string
  operations: Array<Record<string, unknown>>
}

interface ToolMemoryRow {
  id: string
  tool_name: string
  tool_args: Record<string, unknown> | null
  tool_output: Record<string, unknown> | null
  session_id: string | null
  summary: string
  created_at: string
  similarity?: number
  embedding?: Float32Array | number[] | string
}

/** Store a tool memory embedding */
export async function storeOperation(
  pool: Pool,
  embedding: Float32Array,
  metadata: OperationMetadata
): Promise<string> {
  const vectorStr = `[${Array.from(embedding).join(',')}]`

  const result = await pool.query(
    `INSERT INTO tool_memories
      (embedding, tool_name, tool_args, user_id, session_id, summary, tool_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      vectorStr,
      metadata.toolName,
      metadata.toolArgs ? JSON.stringify(metadata.toolArgs) : null,
      metadata.userId || null,
      metadata.sessionId || null,
      metadata.summary,
      metadata.toolOutput ? JSON.stringify(metadata.toolOutput) : null
    ]
  )

  return (result.rows[0] as ToolMemoryRow).id
}

/** Find similar tool memories by embedding */
export async function findSimilar(
  pool: Pool,
  embedding: Float32Array,
  filters: OperationFilters = {},
  options: QueryOptions = {}
): Promise<Record<string, unknown>[]> {
  const topK = options.topK || 10
  const threshold = options.threshold || 0.5
  const vectorStr = `[${Array.from(embedding).join(',')}]`

  const conditions: string[] = []
  const params: unknown[] = [vectorStr]
  let paramIdx = 2

  if (filters.toolName) {
    conditions.push(`tool_name = $${paramIdx++}`)
    params.push(filters.toolName)
  }
  if (filters.days) {
    conditions.push(`created_at > NOW() - INTERVAL '${parseInt(String(filters.days), 10)} days'`)
  }
  if (filters.sessionId) {
    conditions.push(`session_id = $${paramIdx++}`)
    params.push(filters.sessionId)
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  params.push(topK)

  const result = await pool.query(
    `SELECT id, tool_name, tool_args, tool_output, session_id,
            summary, created_at,
            1 - (embedding <=> $1) AS similarity
     FROM tool_memories
     ${whereClause}
     ORDER BY embedding <=> $1
     LIMIT $${paramIdx}`,
    params
  )

  return (result.rows as ToolMemoryRow[]).filter(
    (row) => (row.similarity ?? 0) >= threshold
  ) as unknown as Record<string, unknown>[]
}

/**
 * Detect gaps between actual operations and expected workflow steps
 */
export async function detectGaps(
  pool: Pool,
  templateEmbeddings: ReadonlyArray<TemplateEmbedding>,
  filters: GapFilters = {},
  options: GapOptions = {}
): Promise<GapResult[]> {
  const threshold = options.threshold || 0.7

  const conditions: string[] = []
  const baseParams: unknown[] = []
  let paramIdx = 1

  if (filters.recordId) {
    conditions.push(`tool_args->>'id' = $${paramIdx++}`)
    baseParams.push(filters.recordId)
  }
  if (filters.modelName) {
    conditions.push(`tool_args->>'model' = $${paramIdx}`)
    baseParams.push(filters.modelName)
  }

  const whereClause = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''

  const gaps: GapResult[] = []

  for (const { label, embedding } of templateEmbeddings) {
    const vectorStr = `[${Array.from(embedding).join(',')}]`
    const params = [vectorStr, ...baseParams]

    const result = await pool.query(
      `SELECT MAX(1 - (embedding <=> $1)) AS max_similarity
       FROM tool_memories
       WHERE TRUE ${whereClause}`,
      params
    )

    const row = result.rows[0] as { max_similarity: number | null } | undefined
    const maxSimilarity = row?.max_similarity || 0

    if (maxSimilarity < threshold) {
      gaps.push({
        step: label,
        confidence: parseFloat(String(maxSimilarity)),
        status: maxSimilarity < 0.3 ? 'missing' : 'incomplete'
      })
    }
  }

  return gaps
}

/**
 * Group tool memories into clusters by semantic similarity
 *
 * Uses a simple greedy clustering: assign each operation to the nearest
 * existing cluster or start a new one if similarity is below threshold.
 */
export async function getClusters(
  pool: Pool,
  filters: ClusterFilters = {},
  options: ClusterOptions = {}
): Promise<ClusterResult> {
  const days = filters.days || 7
  const minClusterSize = options.minClusterSize || 2
  const similarityThreshold = options.similarityThreshold || 0.75

  const conditions = [`created_at > NOW() - INTERVAL '${parseInt(String(days), 10)} days'`]
  const params: unknown[] = []
  const paramIdx = 1

  if (filters.toolName) {
    conditions.push(`tool_name = $${paramIdx}`)
    params.push(filters.toolName)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  const result = await pool.query(
    `SELECT id, tool_name, tool_args, tool_output,
            summary, created_at, embedding
     FROM tool_memories
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 500`,
    params
  )

  const rows = result.rows as ToolMemoryRow[]

  if (rows.length === 0) {
    return { clusters: [], outliers: [] }
  }

  // Greedy clustering
  const clusters: ClusterEntry[] = []
  const assigned = new Set<number>()

  for (let i = 0; i < rows.length; i++) {
    if (assigned.has(i)) continue

    const cluster: ClusterEntry = {
      representative: rows[i]!.summary,
      toolName: rows[i]!.tool_name,
      operations: [formatOperation(rows[i]!)]
    }
    assigned.add(i)

    const embeddingI = rows[i]!.embedding

    for (let j = i + 1; j < rows.length; j++) {
      if (assigned.has(j)) continue

      const similarity = cosineSimilarity(
        embeddingI as Float32Array | number[] | string,
        rows[j]!.embedding as Float32Array | number[] | string
      )
      if (similarity >= similarityThreshold) {
        cluster.operations.push(formatOperation(rows[j]!))
        assigned.add(j)
      }
    }

    clusters.push(cluster)
  }

  // Separate clusters from outliers
  const validClusters = clusters.filter((c) => c.operations.length >= minClusterSize)
  const outliers = clusters
    .filter((c) => c.operations.length < minClusterSize)
    .flatMap((c) => c.operations)

  return {
    clusters: validClusters.map((c) => ({
      representative: c.representative,
      toolName: c.toolName,
      count: c.operations.length,
      operations: c.operations
    })),
    outliers
  }
}

/** Get tool memory statistics */
export async function getStats(
  pool: Pool,
  filters: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  const days = (filters.days as number) || 30
  const conditions = [`created_at > NOW() - INTERVAL '${parseInt(String(days), 10)} days'`]
  const params: unknown[] = []
  const paramIdx = 1

  if (filters.toolName) {
    conditions.push(`tool_name = $${paramIdx}`)
    params.push(filters.toolName)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  const result = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(DISTINCT tool_name) AS tools,
       COUNT(DISTINCT tool_args->>'model') AS models,
       COUNT(DISTINCT tool_args->>'id') AS records,
       COUNT(DISTINCT session_id) AS sessions,
       tool_name
     FROM tool_memories
     ${whereClause}
     GROUP BY GROUPING SETS ((), (tool_name))`,
    params
  )

  return result.rows as Record<string, unknown>[]
}

/** Delete expired tool memory embeddings */
export async function cleanupExpired(pool: Pool, retentionDays = 30): Promise<number> {
  const result = await pool.query(
    `DELETE FROM tool_memories
     WHERE created_at < NOW() - INTERVAL '${parseInt(String(retentionDays), 10)} days'`
  )
  return result.rowCount ?? 0
}

/** Format an operation row for output */
function formatOperation(row: ToolMemoryRow): Record<string, unknown> {
  const op: Record<string, unknown> = {
    id: row.id,
    toolName: row.tool_name,
    toolArgs: row.tool_args,
    summary: row.summary,
    createdAt: row.created_at
  }
  if (row.tool_output) op.toolOutput = row.tool_output
  return op
}
