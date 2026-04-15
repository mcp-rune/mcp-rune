/**
 * pgvector Ingested Records - Store, Query, and Cleanup
 *
 * Supports the analysis_ingest → analysis_query → analysis_clear pattern
 * for large-scale dataset analysis. Records are stored as JSONB for
 * structured queries (aggregation, filtering, sampling).
 *
 * All functions receive the pg pool as the first argument.
 */

import type { Pool } from 'pg'

export interface IngestParams {
  analysisId: string
  model: string
  records: Array<{ id?: string; data: Record<string, unknown> }>
}

export interface AggregateQuery {
  mode: 'aggregate'
  groupBy: string
}

export interface FilterQuery {
  mode: 'filter'
  where: Record<string, unknown>
  limit?: number
}

export interface SampleQuery {
  mode: 'sample'
  sampleSize?: number
}

export type IngestedQuery = AggregateQuery | FilterQuery | SampleQuery

interface IngestedRow {
  id: string
  analysis_id: string
  model: string
  record_id: string | null
  data: Record<string, unknown>
  created_at: string
}

/** Store a batch of ingested records */
export async function storeRecords(pool: Pool, params: IngestParams): Promise<number> {
  if (params.records.length === 0) return 0

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  // Build a multi-row INSERT for efficiency
  const values: unknown[] = []
  const placeholders: string[] = []
  let paramIdx = 1

  for (const record of params.records) {
    const recordId = record.id || (record.data.id as string) || null
    placeholders.push(
      `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
    )
    values.push(params.analysisId, params.model, recordId, JSON.stringify(record.data), expiresAt)
  }

  await pool.query(
    `INSERT INTO ingested_records (analysis_id, model, record_id, data, expires_at)
     VALUES ${placeholders.join(', ')}`,
    values
  )

  return params.records.length
}

/** Query ingested records — aggregate, filter, or sample */
export async function queryRecords(
  pool: Pool,
  analysisId: string,
  query: IngestedQuery
): Promise<Record<string, unknown>[]> {
  // Evict expired rows on access
  await cleanupExpired(pool)

  switch (query.mode) {
    case 'aggregate':
      return queryAggregate(pool, analysisId, query)
    case 'filter':
      return queryFilter(pool, analysisId, query)
    case 'sample':
      return querySample(pool, analysisId, query)
  }
}

/** GROUP BY on a JSONB field */
async function queryAggregate(
  pool: Pool,
  analysisId: string,
  query: AggregateQuery
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `SELECT data->>$2 AS value, COUNT(*)::integer AS count
     FROM ingested_records
     WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     GROUP BY data->>$2
     ORDER BY count DESC`,
    [analysisId, query.groupBy]
  )

  return (result.rows as Array<{ value: string | null; count: number }>).map((row) => ({
    value: row.value,
    count: row.count
  }))
}

/** JSONB containment filter */
async function queryFilter(
  pool: Pool,
  analysisId: string,
  query: FilterQuery
): Promise<Record<string, unknown>[]> {
  const limit = Math.min(query.limit || 20, 200)
  const result = await pool.query(
    `SELECT data
     FROM ingested_records
     WHERE analysis_id = $1 AND data @> $2 AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT $3`,
    [analysisId, JSON.stringify(query.where), limit]
  )

  return (result.rows as IngestedRow[]).map((row) => row.data)
}

/** Random sample */
async function querySample(
  pool: Pool,
  analysisId: string,
  query: SampleQuery
): Promise<Record<string, unknown>[]> {
  const sampleSize = Math.min(query.sampleSize || 5, 50)
  const result = await pool.query(
    `SELECT data
     FROM ingested_records
     WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY RANDOM()
     LIMIT $2`,
    [analysisId, sampleSize]
  )

  return (result.rows as IngestedRow[]).map((row) => row.data)
}

/** Clear ingested records by analysis ID */
export async function clearRecords(pool: Pool, analysisId: string): Promise<number> {
  const result = await pool.query(`DELETE FROM ingested_records WHERE analysis_id = $1`, [
    analysisId
  ])
  return result.rowCount ?? 0
}

/** Delete expired ingested records (on-access eviction) */
export async function cleanupExpired(pool: Pool): Promise<number> {
  const result = await pool.query(`DELETE FROM ingested_records WHERE expires_at < NOW()`)
  return result.rowCount ?? 0
}
