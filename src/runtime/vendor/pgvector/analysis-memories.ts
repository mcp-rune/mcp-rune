/**
 * pgvector Analysis Memories - Store, Recall, and Cleanup
 *
 * Implements the AnalysisMemoriesAdapter contract defined in
 * `src/runtime/vector-storage-definitions.ts`. Supports the map-reduce
 * pattern for large-scale qualitative analysis: findings are stored with
 * embeddings for semantic recall and can be ephemeral (auto-expire after
 * 1 hour) or persistent.
 */

import type { Pool } from 'pg'

import type {
  AnalysisMemoryMetadata,
  RecallFilters,
  RecallOptions
} from '#src/runtime/vector-storage-definitions-analysis-memories.js'

interface AnalysisMemoryRow {
  id: string
  analysis_id: string
  finding: string
  category: string | null
  metadata: Record<string, unknown> | null
  persistent: boolean
  created_at: string
  similarity?: number
}

/** Store an analysis finding with embedding */
export async function storeMemory(
  pool: Pool,
  embedding: Float32Array,
  metadata: AnalysisMemoryMetadata
): Promise<string> {
  const vectorStr = `[${Array.from(embedding).join(',')}]`

  const result = await pool.query(
    `INSERT INTO analysis_memories
      (analysis_id, finding, category, metadata, embedding, persistent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      metadata.analysisId,
      metadata.finding,
      metadata.category || null,
      metadata.metadata ? JSON.stringify(metadata.metadata) : '{}',
      vectorStr,
      metadata.persistent || false,
      metadata.persistent ? null : new Date(Date.now() + 60 * 60 * 1000) // 1 hour default
    ]
  )

  return (result.rows[0] as AnalysisMemoryRow).id
}

/** Recall analysis memories by analysis ID and/or semantic query */
export async function recallMemories(
  pool: Pool,
  filters: RecallFilters = {},
  options: RecallOptions = {}
): Promise<Record<string, unknown>[]> {
  const topK = options.topK || 50

  // Evict expired rows on access
  await cleanupExpired(pool)

  const conditions = ['(persistent = TRUE OR expires_at > NOW())']
  const params: unknown[] = []
  let paramIdx = 1

  if (filters.analysisId) {
    conditions.push(`analysis_id = $${paramIdx++}`)
    params.push(filters.analysisId)
  }
  if (filters.category) {
    conditions.push(`category = $${paramIdx++}`)
    params.push(filters.category)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  // Semantic query mode
  if (filters.embedding) {
    const vectorStr = `[${Array.from(filters.embedding).join(',')}]`
    params.push(vectorStr)
    const vectorParam = `$${paramIdx++}`
    params.push(topK)
    const limitParam = `$${paramIdx}`

    const result = await pool.query(
      `SELECT id, analysis_id, finding, category, metadata,
              persistent, created_at,
              1 - (embedding <=> ${vectorParam}) AS similarity
       FROM analysis_memories
       ${whereClause}
       ORDER BY embedding <=> ${vectorParam}
       LIMIT ${limitParam}`,
      params
    )

    const threshold = options.threshold || 0.5
    return (result.rows as AnalysisMemoryRow[])
      .filter((row) => (row.similarity ?? 0) >= threshold)
      .map(formatMemory)
  }

  // ID-based query mode
  params.push(topK)
  const limitParam = `$${paramIdx}`

  const result = await pool.query(
    `SELECT id, analysis_id, finding, category, metadata,
            persistent, created_at
     FROM analysis_memories
     ${whereClause}
     ORDER BY created_at ASC
     LIMIT ${limitParam}`,
    params
  )

  return (result.rows as AnalysisMemoryRow[]).map(formatMemory)
}

/** Clear analysis memories by analysis ID */
export async function clearMemories(pool: Pool, analysisId: string): Promise<number> {
  const result = await pool.query(`DELETE FROM analysis_memories WHERE analysis_id = $1`, [
    analysisId
  ])
  return result.rowCount ?? 0
}

/** Delete expired analysis memories (on-access eviction) */
export async function cleanupExpired(pool: Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM analysis_memories
     WHERE persistent = FALSE AND expires_at < NOW()`
  )
  return result.rowCount ?? 0
}

/** Format a memory row for output */
function formatMemory(row: AnalysisMemoryRow): Record<string, unknown> {
  const memory: Record<string, unknown> = {
    id: row.id,
    analysisId: row.analysis_id,
    finding: row.finding,
    createdAt: row.created_at
  }
  if (row.category) memory.category = row.category
  if (row.metadata && Object.keys(row.metadata).length > 0) memory.metadata = row.metadata
  if (row.persistent) memory.persistent = true
  if (row.similarity !== undefined) memory.similarity = parseFloat(String(row.similarity))
  return memory
}
