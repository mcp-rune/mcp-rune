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

export interface RecordEmbedding {
  /** Index into the `records` array this embedding corresponds to. */
  recordIndex: number
  /** 384-dim MiniLM vector. */
  vector: Float32Array
  /** The textification fed to the embedding model — persisted for audit/recall. */
  text: string
}

export interface IngestParams {
  analysisId: string
  model: string
  records: Array<{ id?: string; data: Record<string, unknown> }>
  /** Optional per-record embeddings; when absent, embedding columns stay NULL. */
  embeddings?: ReadonlyArray<RecordEmbedding>
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

export interface ProximityParams {
  /** Date/datetime field to center the proximity window on */
  field: string
  /** Center date in ISO 8601 format (e.g., "2026-03-15") */
  origin: string
  /** Time window around origin, e.g., "7 days", "2 weeks", "1 month" */
  window: string
  /** Bucket interval for stratification within the window (e.g., "1 day", "1 week") */
  bucket?: string
}

export interface SampleQuery {
  mode: 'sample'
  sampleSize?: number
  stratifyBy?: string
  where?: Record<string, unknown>
  proximity?: ProximityParams
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

/**
 * Retention window for ingested records (in days). Set at init time via
 * setRetentionDays(); multiplied to ms at the INSERT site.
 */
let retentionDays = 7

/** Configure how long newly-ingested records survive before eviction. */
export function setRetentionDays(days: number): void {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid retentionDays: ${days}. Must be a positive number.`)
  }
  retentionDays = days
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

const INTERVAL_RE = /^\d+\s+(day|days|week|weeks|month|months|hour|hours|minute|minutes)$/i

/** Validate interval string to prevent SQL injection (only safe PostgreSQL intervals) */
function validateInterval(interval: string): string {
  if (!INTERVAL_RE.test(interval.trim())) {
    throw new Error(
      `Invalid interval: "${interval}". Use format like "7 days", "2 weeks", "1 month".`
    )
  }
  return interval.trim()
}

/**
 * Build WHERE conditions from a filter object.
 *
 * Shared between queryFilter and querySample (when pre-filtering).
 * Returns additional SQL conditions and updates params/paramIdx in place.
 */
function buildWhereConditions(
  where: Record<string, unknown>,
  params: unknown[],
  paramIdx: number
): { conditions: string[]; paramIdx: number } {
  const exactFields: Record<string, unknown> = {}
  const rangeConditions: { field: string; op: string; value: unknown }[] = []

  for (const [field, value] of Object.entries(where)) {
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

  const conditions: string[] = []

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

  return { conditions, paramIdx }
}

/** Store a batch of ingested records, optionally with per-record embeddings. */
export async function storeRecords(pool: Pool, params: IngestParams): Promise<number> {
  if (params.records.length === 0) return 0

  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000)

  const embeddingsByIndex: Map<number, RecordEmbedding> = params.embeddings
    ? new Map(params.embeddings.map((e) => [e.recordIndex, e]))
    : new Map()

  // Build a multi-row INSERT for efficiency
  const values: unknown[] = []
  const placeholders: string[] = []
  let paramIdx = 1

  for (let i = 0; i < params.records.length; i++) {
    const record = params.records[i]!
    const recordId = record.id || (record.data.id as string) || null
    const embedding = embeddingsByIndex.get(i)
    const vectorStr = embedding ? `[${Array.from(embedding.vector).join(',')}]` : null
    const embeddingText = embedding ? embedding.text : null
    const embeddedAt = embedding ? new Date() : null

    placeholders.push(
      `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
    )
    values.push(
      params.analysisId,
      params.model,
      recordId,
      JSON.stringify(record.data),
      expiresAt,
      vectorStr,
      embeddingText,
      embeddedAt
    )
  }

  await pool.query(
    `INSERT INTO ingested_records
       (analysis_id, model, record_id, data, expires_at, embedding, embedding_text, embedded_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (analysis_id, model, record_id) WHERE record_id IS NOT NULL
     DO UPDATE SET
       data = EXCLUDED.data,
       expires_at = EXCLUDED.expires_at,
       embedding = COALESCE(EXCLUDED.embedding, ingested_records.embedding),
       embedding_text = COALESCE(EXCLUDED.embedding_text, ingested_records.embedding_text),
       embedded_at = COALESCE(EXCLUDED.embedded_at, ingested_records.embedded_at)`,
    values
  )

  return params.records.length
}

/**
 * Fetch records whose `embedding` is NULL — used by ensureRecordEmbeddings
 * back-fill (e.g., when a `cluster` stratifier is requested on a session
 * that was ingested with `embed_records: false`).
 */
export async function getRecordsWithoutEmbeddings(
  pool: Pool,
  analysisId: string,
  model: string,
  limit = 500
): Promise<Array<{ recordId: string; data: Record<string, unknown> }>> {
  const result = await pool.query(
    `SELECT record_id, data FROM ingested_records
     WHERE analysis_id = $1 AND model = $2
       AND embedding IS NULL
       AND record_id IS NOT NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT $3`,
    [analysisId, model, limit]
  )
  return (result.rows as Array<{ record_id: string; data: Record<string, unknown> }>).map((r) => ({
    recordId: r.record_id,
    data: r.data
  }))
}

/** Back-fill embeddings for a set of already-stored record_ids. */
export async function updateRecordEmbeddings(
  pool: Pool,
  analysisId: string,
  model: string,
  updates: ReadonlyArray<{ recordId: string; vector: Float32Array; text: string }>
): Promise<number> {
  if (updates.length === 0) return 0
  const embeddedAt = new Date()
  let updated = 0
  for (const u of updates) {
    const vectorStr = `[${Array.from(u.vector).join(',')}]`
    const result = await pool.query(
      `UPDATE ingested_records
       SET embedding = $4, embedding_text = $5, embedded_at = $6
       WHERE analysis_id = $1 AND model = $2 AND record_id = $3`,
      [analysisId, model, u.recordId, vectorStr, u.text, embeddedAt]
    )
    updated += result.rowCount ?? 0
  }
  return updated
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

  const conditions = ['analysis_id = $1', '(expires_at IS NULL OR expires_at > NOW())']
  const params: unknown[] = [analysisId]

  const where = buildWhereConditions(query.where, params, 2)
  conditions.push(...where.conditions)

  params.push(limit)

  const result = await pool.query(
    `SELECT data
     FROM ingested_records
     WHERE ${conditions.join(' AND ')}
     LIMIT $${where.paramIdx}`,
    params
  )

  return (result.rows as IngestedRow[]).map((row) => row.data)
}

/** Random sample — supports optional pre-filtering, proximity windowing, and stratification */
async function querySample(
  pool: Pool,
  analysisId: string,
  query: SampleQuery
): Promise<Record<string, unknown>[]> {
  const sampleSize = Math.min(query.sampleSize || 5, 50)

  // Delegate to proximity-aware path when where or proximity are provided
  if (query.where || query.proximity) {
    return querySampleFiltered(pool, analysisId, sampleSize, query)
  }

  if (query.stratifyBy) {
    return querySampleStratified(pool, analysisId, sampleSize, query.stratifyBy)
  }

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

/**
 * Pre-filtered sample with optional proximity windowing and bucket stratification.
 *
 * Builds a `filtered` CTE from the base conditions + where clauses + proximity
 * date window, then applies stratification on top (by date bucket, discrete field,
 * or both).
 *
 * Proximity uses PostgreSQL date_bin() to create origin-anchored time buckets,
 * then applies the same ROW_NUMBER() OVER (PARTITION BY) budget allocation as
 * querySampleStratified.
 */
async function querySampleFiltered(
  pool: Pool,
  analysisId: string,
  sampleSize: number,
  query: SampleQuery
): Promise<Record<string, unknown>[]> {
  const baseConditions = ['analysis_id = $1', '(expires_at IS NULL OR expires_at > NOW())']
  const params: unknown[] = [analysisId]
  let paramIdx = 2

  // Apply where conditions
  if (query.where) {
    const where = buildWhereConditions(query.where, params, paramIdx)
    baseConditions.push(...where.conditions)
    paramIdx = where.paramIdx
  }

  // Apply proximity date window
  if (query.proximity) {
    const safeField = sanitizeFieldName(query.proximity.field)
    const validWindow = validateInterval(query.proximity.window)

    baseConditions.push(
      `(data->>'${safeField}')::timestamptz >= ($${paramIdx}::timestamptz - '${validWindow}'::interval)`
    )
    params.push(query.proximity.origin)
    paramIdx++

    baseConditions.push(
      `(data->>'${safeField}')::timestamptz <= ($${paramIdx}::timestamptz + '${validWindow}'::interval)`
    )
    params.push(query.proximity.origin)
    paramIdx++
  }

  const filteredCte = `filtered AS (
    SELECT data FROM ingested_records
    WHERE ${baseConditions.join(' AND ')}
  )`

  // Determine stratification strategy
  const hasBucket = query.proximity?.bucket
  const hasStratify = query.stratifyBy

  if (!hasBucket && !hasStratify) {
    // Simple filtered random sample
    params.push(sampleSize)
    const result = await pool.query(
      `WITH ${filteredCte}
       SELECT data FROM filtered
       ORDER BY RANDOM()
       LIMIT $${paramIdx}`,
      params
    )
    return (result.rows as IngestedRow[]).map((row) => row.data)
  }

  // Build PARTITION BY expression for stratification
  const partitionParts: string[] = []

  if (hasBucket) {
    const safeField = sanitizeFieldName(query.proximity!.field)
    const validBucket = validateInterval(query.proximity!.bucket!)

    // date_bin(bucket_interval, timestamp, origin) — origin-anchored buckets
    const binExpr = `date_bin('${validBucket}'::interval, (data->>'${safeField}')::timestamptz, $${paramIdx}::timestamptz)`
    params.push(query.proximity!.origin)
    paramIdx++

    partitionParts.push(binExpr)
  }

  if (hasStratify) {
    const safeStratify = sanitizeFieldName(query.stratifyBy!)
    partitionParts.push(`data->>'${safeStratify}'`)
  }

  const partitionBy = partitionParts.join(', ')

  // Build the count expression to match the partition
  // We need DISTINCT on the same composite key
  const countExpr =
    partitionParts.length === 1
      ? `COUNT(DISTINCT ${partitionParts[0]}) AS num_groups`
      : `COUNT(DISTINCT ROW(${partitionParts.join(', ')})) AS num_groups`

  params.push(sampleSize)
  const sampleParamIdx = paramIdx

  const result = await pool.query(
    `WITH ${filteredCte},
     ranked AS (
       SELECT data,
         ROW_NUMBER() OVER (
           PARTITION BY ${partitionBy} ORDER BY RANDOM()
         ) AS rn
       FROM filtered
     ),
     group_count AS (
       SELECT ${countExpr}
       FROM filtered
     )
     SELECT ranked.data
     FROM ranked, group_count
     WHERE ranked.rn <= GREATEST(1, CEIL($${sampleParamIdx}::numeric / GREATEST(1, group_count.num_groups)))
     ORDER BY RANDOM()
     LIMIT $${sampleParamIdx}`,
    params
  )

  return (result.rows as IngestedRow[]).map((row) => row.data)
}

/**
 * Stratified sampling: distributes sample slots evenly across distinct values
 * of the given JSONB field, ensuring minority groups are always represented.
 *
 * Without stratification, ORDER BY RANDOM() heavily favors the majority group.
 * E.g., 85 "active" + 10 "draft" + 5 "archived" with sampleSize=6 would almost
 * always return 6 "active" records.
 *
 * The query works in three stages:
 *
 * 1. CTE `ranked` — assigns a random rank within each group using
 *    ROW_NUMBER() OVER (PARTITION BY field ORDER BY RANDOM()).
 *    Each group's rows are independently shuffled and numbered 1, 2, 3...
 *
 * 2. CTE `group_count` — counts distinct values of the stratification field
 *    to calculate the per-group budget: CEIL(sampleSize / numGroups).
 *    With sampleSize=6 and 3 groups, each group gets 2 slots.
 *
 * 3. Final SELECT — keeps only rows where rn <= per-group budget, ensuring
 *    equal representation. A final ORDER BY RANDOM() shuffles the output so
 *    groups aren't clustered, and LIMIT caps the total to sampleSize.
 *
 * Edge cases:
 * - GREATEST(1, num_groups) prevents division by zero
 * - GREATEST(1, CEIL(...)) ensures at least 1 record per group
 * - When sampleSize doesn't divide evenly (e.g., 5 slots / 3 groups = CEIL 2),
 *   the per-group budget over-allocates (2 x 3 = 6), and LIMIT 5 trims one
 * - sanitizeFieldName() validates the field against /^[a-zA-Z_][a-zA-Z0-9_]*$/
 *   since column identifiers can't use $N parameterization in PostgreSQL
 */
async function querySampleStratified(
  pool: Pool,
  analysisId: string,
  sampleSize: number,
  stratifyBy: string
): Promise<Record<string, unknown>[]> {
  const safeField = sanitizeFieldName(stratifyBy)

  const result = await pool.query(
    `WITH ranked AS (
       SELECT data,
         ROW_NUMBER() OVER (
           PARTITION BY data->>'${safeField}' ORDER BY RANDOM()
         ) AS rn
       FROM ingested_records
       WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ),
     group_count AS (
       SELECT COUNT(DISTINCT data->>'${safeField}') AS num_groups
       FROM ingested_records
       WHERE analysis_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     )
     SELECT ranked.data
     FROM ranked, group_count
     WHERE ranked.rn <= GREATEST(1, CEIL($2::numeric / GREATEST(1, group_count.num_groups)))
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

/** Get count of ingested records for a given analysis session and model */
export async function getRecordCount(
  pool: Pool,
  analysisId: string,
  model: string
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::integer AS count FROM ingested_records
     WHERE analysis_id = $1 AND model = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [analysisId, model]
  )
  return (result.rows[0] as { count: number })?.count ?? 0
}

/** Get all record IDs for a given analysis session and model */
export async function getRecordIds(
  pool: Pool,
  analysisId: string,
  model: string
): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT record_id FROM ingested_records
     WHERE analysis_id = $1 AND model = $2
       AND record_id IS NOT NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [analysisId, model]
  )
  return (result.rows as Array<{ record_id: string }>).map((r) => r.record_id)
}

/**
 * Get record IDs matching an optional WHERE predicate.
 *
 * Reuses buildWhereConditions for the same operator vocabulary as queryFilter,
 * but returns IDs only — used by analysis_act to resolve a mutation set without
 * shipping rows back to the LLM.
 */
export async function getRecordIdsFiltered(
  pool: Pool,
  analysisId: string,
  model: string,
  where?: Record<string, unknown>
): Promise<string[]> {
  const conditions = [
    'analysis_id = $1',
    'model = $2',
    'record_id IS NOT NULL',
    '(expires_at IS NULL OR expires_at > NOW())'
  ]
  const params: unknown[] = [analysisId, model]

  if (where && Object.keys(where).length > 0) {
    const built = buildWhereConditions(where, params, 3)
    conditions.push(...built.conditions)
  }

  const result = await pool.query(
    `SELECT DISTINCT record_id FROM ingested_records
     WHERE ${conditions.join(' AND ')}`,
    params
  )
  return (result.rows as Array<{ record_id: string }>).map((r) => r.record_id)
}

export interface DryRunResult {
  matchedCount: number
  sampleIds: string[]
  sampleData: Array<Record<string, unknown> & { ingestedAt: string }>
  earliestIngestedAt: string | null
  latestIngestedAt: string | null
}

/**
 * Preview a filtered set without mutating: returns total match count, the first
 * few IDs, a small sample of full rows annotated with their ingestion timestamp,
 * and the ingestedAt range so the caller can judge snapshot staleness.
 */
export async function getRecordsForDryRun(
  pool: Pool,
  analysisId: string,
  model: string,
  where?: Record<string, unknown>,
  sampleLimit = 3
): Promise<DryRunResult> {
  const conditions = [
    'analysis_id = $1',
    'model = $2',
    '(expires_at IS NULL OR expires_at > NOW())'
  ]
  const params: unknown[] = [analysisId, model]

  if (where && Object.keys(where).length > 0) {
    const built = buildWhereConditions(where, params, 3)
    conditions.push(...built.conditions)
  }

  const whereClause = conditions.join(' AND ')

  const countResult = await pool.query(
    `SELECT COUNT(*)::integer AS count,
            MIN(created_at) AS earliest,
            MAX(created_at) AS latest
     FROM ingested_records WHERE ${whereClause}`,
    params
  )
  const countRow = countResult.rows[0] as {
    count: number
    earliest: string | null
    latest: string | null
  }

  const sampleResult = await pool.query(
    `SELECT record_id, data, created_at FROM ingested_records
     WHERE ${whereClause}
     ORDER BY created_at ASC
     LIMIT $${params.length + 1}`,
    [...params, Math.max(sampleLimit, 10)]
  )
  const rows = sampleResult.rows as Array<{
    record_id: string | null
    data: Record<string, unknown>
    created_at: string
  }>

  const sampleIds = rows
    .map((r) => r.record_id)
    .filter((id): id is string => id !== null)
    .slice(0, 10)

  const sampleData = rows.slice(0, sampleLimit).map((r) => ({
    ...r.data,
    ingestedAt: r.created_at
  }))

  return {
    matchedCount: countRow.count,
    sampleIds,
    sampleData,
    earliestIngestedAt: countRow.earliest,
    latestIngestedAt: countRow.latest
  }
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
