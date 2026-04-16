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

export interface SessionDescriptor {
  model: string
  totalRecords: number
}

interface IngestedRow {
  id: string
  analysis_id: string
  model: string
  record_id: string | null
  data: Record<string, unknown>
  created_at: string
}

// --- Comparison operator support for range queries ---

const COMPARISON_OPS = {
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<='
} as const

type ComparisonOp = keyof typeof COMPARISON_OPS

const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Validate field name to prevent SQL injection (only alphanumeric + underscores) */
function sanitizeFieldName(field: string): string {
  if (!FIELD_NAME_RE.test(field)) {
    throw new Error(`Invalid field name: ${field}`)
  }
  return field
}

/** Check if a value is an operator object containing comparison keys */
function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value).some((k) => k in COMPARISON_OPS)
}

/**
 * Infer PostgreSQL cast from the comparison value type.
 *
 * - Numbers → ::numeric
 * - ISO 8601 date strings → ::timestamptz
 * - Other strings → text comparison (no cast)
 */
function inferCast(value: unknown): string {
  if (typeof value === 'number') return '::numeric'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return '::timestamptz'
  return ''
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

/**
 * Filter ingested records with exact match and range operator support.
 *
 * Exact match values use JSONB containment (@>):
 *   { "status": "active" } → data @> '{"status": "active"}'
 *
 * Operator objects use parameterized ->> extraction with casting:
 *   { "duration_minutes": { "$gte": 40, "$lte": 120 } }
 *   → (data->>'duration_minutes')::numeric >= 40 AND (data->>'duration_minutes')::numeric <= 120
 *
 *   { "started_at": { "$gte": "2026-01-01" } }
 *   → (data->>'started_at')::timestamptz >= '2026-01-01'
 */
async function queryFilter(
  pool: Pool,
  analysisId: string,
  query: FilterQuery
): Promise<Record<string, unknown>[]> {
  const limit = Math.min(query.limit || 20, 200)

  const exactFields: Record<string, unknown> = {}
  const rangeConditions: { field: string; op: string; value: unknown }[] = []

  for (const [field, value] of Object.entries(query.where)) {
    if (isOperatorObject(value)) {
      const safeField = sanitizeFieldName(field)
      for (const [opKey, opValue] of Object.entries(value)) {
        if (opKey in COMPARISON_OPS) {
          rangeConditions.push({
            field: safeField,
            op: COMPARISON_OPS[opKey as ComparisonOp],
            value: opValue
          })
        }
      }
    } else {
      exactFields[field] = value
    }
  }

  const conditions = ['analysis_id = $1', '(expires_at IS NULL OR expires_at > NOW())']
  const params: unknown[] = [analysisId]
  let paramIdx = 2

  // Exact match via JSONB containment
  if (Object.keys(exactFields).length > 0) {
    conditions.push(`data @> $${paramIdx}`)
    params.push(JSON.stringify(exactFields))
    paramIdx++
  }

  // Range conditions via ->> extraction with type casting
  for (const { field, op, value } of rangeConditions) {
    const cast = inferCast(value)
    conditions.push(`(data->>'${field}')${cast} ${op} $${paramIdx}`)
    params.push(value)
    paramIdx++
  }

  params.push(limit)

  const result = await pool.query(
    `SELECT data
     FROM ingested_records
     WHERE ${conditions.join(' AND ')}
     LIMIT $${paramIdx}`,
    params
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

/** Describe an analysis session — returns model name and record count */
export async function describeSession(
  pool: Pool,
  analysisId: string
): Promise<SessionDescriptor | null> {
  const result = await pool.query(
    `SELECT model, COUNT(*)::integer AS total
     FROM ingested_records
     WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     GROUP BY model
     LIMIT 1`,
    [analysisId]
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0] as { model: string; total: number }
  return { model: row.model, totalRecords: row.total }
}

/** Get all record IDs for a given analysis session and model */
export async function getRecordIds(
  pool: Pool,
  analysisId: string,
  model: string
): Promise<string[]> {
  const result = await pool.query(
    `SELECT record_id FROM ingested_records
     WHERE analysis_id = $1 AND model = $2
       AND record_id IS NOT NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [analysisId, model]
  )
  return (result.rows as Array<{ record_id: string }>).map((r) => r.record_id)
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
