/**
 * Vector Storage Service - Vendor-Agnostic Public API
 *
 * Shared pgvector backend for analysis and operations tool categories.
 * Stores semantic embeddings for tool operations, analysis findings,
 * and ingested records.
 *
 * Mirrors the facade pattern of tracing.js and error-tracking.js.
 * To switch vendors, update the import below.
 *
 * When not configured (no env vars), all functions become no-ops.
 *
 * @example
 * import { initVectorStorage, storeOperation } from '#src/services/vector-storage.js'
 *
 * // Initialize once at startup
 * initVectorStorage({ serviceName: 'mcp-server-mod', retentionDays: 30 })
 *
 * // Store after tool operations (fire-and-forget)
 * storeOperation({ toolName: 'create_model', toolArgs: { model: 'deal', attributes: { ... } } })
 */

import type { Pool } from 'pg'

import type { Edge } from '#src/mcp/models/edge-extraction.js'
import { buildEmbeddingText } from '#src/mcp/models/edge-extraction.js'

// Vendor implementation - change this import to switch vendors
import { embed, embedBatch } from './embeddings.js'
import { adaptToolOutput } from './tool-output-adapters.js'
import * as analysisMemories from './vendor/pgvector/analysis-memories.js'
import * as vendor from './vendor/pgvector/index.js'
import * as ingestedEdges from './vendor/pgvector/ingested-edges.js'
import * as ingestedRecords from './vendor/pgvector/ingested-records.js'
import * as operations from './vendor/pgvector/tool-memories.js'

/** Batch size for record embedding during ingest. */
const EMBED_BATCH_SIZE = 64

export interface VectorStorageOptions {
  /**
   * Optional Postgres pool injected at startup. Without one, vector storage
   * stays disabled and every vector-storage call becomes a no-op. The same
   * pool used by the integrator's database layer should be passed in so
   * connection limits and lifecycle are shared.
   */
  pool?: Pool
  serviceName?: string
  version?: string
  /** Retention for tool_memories (operations feature). Default 30 days. */
  retentionDays?: number
  /** Retention for ingested_records (analysis feature). Default 7 days. */
  ingestedRecordsRetentionDays?: number
  /** When set, periodic cleanup across all three tables fires on this interval (ms). */
  backgroundCleanupIntervalMs?: number
}

export interface StoreOperationParams {
  toolName: string
  toolArgs?: Record<string, unknown>
  toolOutput?: Record<string, unknown>
  sessionId?: string
  userId?: string
}

export interface OperationFilters {
  toolName?: string
  days?: number
  sessionId?: string
}

export interface QueryOptions {
  topK?: number
  threshold?: number
}

export interface GapFilters {
  recordId?: string
  modelName?: string
}

export interface GapOptions {
  threshold?: number
}

export interface ClusterFilters {
  days?: number
  toolName?: string
}

export interface ClusterOptions {
  minClusterSize?: number
}

export interface ClusterResult {
  clusters: Array<{
    representative: string
    toolName: string
    count: number
    operations: Array<Record<string, unknown>>
  }>
  outliers: Array<Record<string, unknown>>
}

export interface AnalysisMemoryParams {
  analysisId: string
  finding: string
  category?: string
  metadata?: Record<string, unknown>
  persistent?: boolean
}

export interface RecallFilters {
  analysisId?: string
  category?: string
  query?: string
}

export interface RecallOptions {
  topK?: number
  threshold?: number
}

/**
 * Initialize memory storage service
 *
 * Call once at server startup. No-op if env vars not set.
 */
export function initVectorStorage(options: VectorStorageOptions = {}): boolean {
  return vendor.initialize(options)
}

/** Check if vector storage is configured and enabled */
export function isVectorStorageEnabled(): boolean {
  return vendor.isConfigured()
}

/**
 * Store a tool operation embedding
 *
 * Converts the operation to natural language, generates an embedding,
 * and stores both in the vector database. Fire-and-forget from callers.
 */
export async function storeOperation(operation: StoreOperationParams): Promise<string | null> {
  if (!vendor.isConfigured()) return null

  const pool = vendor.getPool()
  if (!pool) return null

  const toolOutput = adaptToolOutput(operation.toolName, operation.toolOutput, operation.toolArgs)
  const summary = operationToText(operation, toolOutput)
  const embedding = await embed(summary)

  return operations.storeOperation(pool, embedding, {
    toolName: operation.toolName,
    toolArgs: operation.toolArgs,
    toolOutput,
    userId: operation.userId,
    sessionId: operation.sessionId,
    summary
  })
}

/**
 * Find operations similar to a query
 */
export async function findSimilarOperations(
  query: string,
  filters: OperationFilters = {},
  options: QueryOptions = {}
): Promise<Record<string, unknown>[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  const embedding = await embed(query)
  return operations.findSimilar(pool, embedding, filters, options)
}

/**
 * Detect gaps in operations for a record
 */
export async function detectOperationGaps(
  expectedSteps: string[],
  filters: GapFilters = {},
  options: GapOptions = {}
): Promise<Array<{ step: string; confidence: number; status: string }>> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  const embeddings = await embedBatch(expectedSteps)
  const templateEmbeddings = expectedSteps.map((label, i) => ({
    label,
    embedding: embeddings[i]!
  }))

  return operations.detectGaps(pool, templateEmbeddings, filters, options)
}

/** Get operation clusters grouped by semantic similarity */
export async function getOperationClusters(
  filters: ClusterFilters = {},
  options: ClusterOptions = {}
): Promise<ClusterResult> {
  if (!vendor.isConfigured()) return { clusters: [], outliers: [] }

  const pool = vendor.getPool()
  if (!pool) return { clusters: [], outliers: [] }

  return operations.getClusters(pool, filters, options)
}

/** Get operation statistics */
export async function getOperationStats(
  filters: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return operations.getStats(pool, filters)
}

/**
 * Store an analysis memory finding
 */
export async function storeAnalysisMemory(params: AnalysisMemoryParams): Promise<string | null> {
  if (!vendor.isConfigured()) return null

  const pool = vendor.getPool()
  if (!pool) return null

  const embedding = await embed(params.finding)
  return analysisMemories.storeMemory(pool, embedding, params)
}

/**
 * Recall analysis memories by filters and/or semantic query
 */
export async function recallAnalysisMemories(
  filters: RecallFilters = {},
  options: RecallOptions = {}
): Promise<Record<string, unknown>[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  const queryFilters: Record<string, unknown> = { ...filters }
  if (filters.query) {
    queryFilters.embedding = await embed(filters.query)
    delete queryFilters.query
  }

  return analysisMemories.recallMemories(pool, queryFilters, options)
}

export interface IngestRecordsParams {
  analysisId: string
  model: string
  records: Array<{ id?: string; data: Record<string, unknown> }>
  /**
   * Opt-in record embeddings. `true` embeds all string-valued attributes;
   * an object form restricts to specific fields. When omitted, the embedding
   * columns stay NULL and a later cluster-stratifier triggers back-fill via
   * ensureRecordEmbeddings.
   */
  embed?: boolean | { fields?: string[] }
}

export type IngestedDataQuery =
  | { mode: 'aggregate'; groupBy: string }
  | { mode: 'filter'; where: Record<string, unknown>; limit?: number }
  | {
      mode: 'sample'
      sampleSize?: number
      stratifyBy?: string
      where?: Record<string, unknown>
      proximity?: ingestedRecords.ProximityParams
      stratifiers?: ReadonlyArray<ingestedRecords.GraphStratifierSpec>
    }

export type { GraphStratifierSpec } from './vendor/pgvector/ingested-records.js'

/** Store ingested records for analysis, optionally embedding them. */
export async function storeIngestedRecords(params: IngestRecordsParams): Promise<number> {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  let embeddings: ingestedRecords.RecordEmbedding[] | undefined
  if (params.embed) {
    const fields = typeof params.embed === 'object' ? params.embed.fields : undefined
    embeddings = await _embedRecordBatch(params.records, fields)
  }

  return ingestedRecords.storeRecords(pool, { ...params, embeddings })
}

/** Embed a batch of records for ingest using buildEmbeddingText + embedBatch. */
async function _embedRecordBatch(
  records: ReadonlyArray<{ data: Record<string, unknown> }>,
  fields?: string[]
): Promise<ingestedRecords.RecordEmbedding[]> {
  const texts: string[] = records.map((r) => buildEmbeddingText(r.data, { fields }))
  const out: ingestedRecords.RecordEmbedding[] = []
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBED_BATCH_SIZE)
    const vectors = await embedBatch(slice)
    for (let j = 0; j < vectors.length; j++) {
      out.push({ recordIndex: start + j, vector: vectors[j]!, text: slice[j]! })
    }
  }
  return out
}

/** Query ingested records (aggregate, filter, or sample) */
export async function queryIngestedData(
  analysisId: string,
  query: IngestedDataQuery
): Promise<Record<string, unknown>[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return ingestedRecords.queryRecords(pool, analysisId, query)
}

/** Surface graph dimensions for describe-mode (edge types + embedding coverage). */
export async function getSessionGraphInfo(
  analysisId: string
): Promise<ingestedRecords.SessionGraphInfo> {
  if (!vendor.isConfigured()) {
    return { edgeTypes: [], embeddedRecordCount: 0, totalRecordCount: 0 }
  }

  const pool = vendor.getPool()
  if (!pool) return { edgeTypes: [], embeddedRecordCount: 0, totalRecordCount: 0 }

  return ingestedRecords.getSessionGraphInfo(pool, analysisId)
}

/** Describe an analysis session — returns model name and record count */
export async function describeAnalysisSession(
  analysisId: string
): Promise<ingestedRecords.SessionDescriptor | null> {
  if (!vendor.isConfigured()) return null

  const pool = vendor.getPool()
  if (!pool) return null

  return ingestedRecords.describeSession(pool, analysisId)
}

/** Get count of ingested records for a given analysis session and model */
export async function getIngestedRecordCount(analysisId: string, model: string): Promise<number> {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  return ingestedRecords.getRecordCount(pool, analysisId, model)
}

/** Get all record IDs for a given analysis session and model */
export async function getIngestedRecordIds(analysisId: string, model: string): Promise<string[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return ingestedRecords.getRecordIds(pool, analysisId, model)
}

/**
 * Get record IDs matching an optional WHERE predicate.
 *
 * Same operator vocabulary as analysis_query mode: "filter". Returns IDs only,
 * so callers (analysis_act) can resolve a mutation set server-side without
 * round-tripping rows through context.
 */
export async function getIngestedRecordIdsFiltered(
  analysisId: string,
  model: string,
  where?: Record<string, unknown>
): Promise<string[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return ingestedRecords.getRecordIdsFiltered(pool, analysisId, model, where)
}

/** Preview a filtered set without mutating — for analysis_act dry_run. */
export async function getIngestedRecordDryRun(
  analysisId: string,
  model: string,
  where?: Record<string, unknown>,
  sampleLimit?: number
): Promise<ingestedRecords.DryRunResult> {
  if (!vendor.isConfigured()) {
    return {
      matchedCount: 0,
      sampleIds: [],
      sampleData: [],
      earliestIngestedAt: null,
      latestIngestedAt: null
    }
  }

  const pool = vendor.getPool()
  if (!pool) {
    return {
      matchedCount: 0,
      sampleIds: [],
      sampleData: [],
      earliestIngestedAt: null,
      latestIngestedAt: null
    }
  }

  return ingestedRecords.getRecordsForDryRun(pool, analysisId, model, where, sampleLimit)
}

/** Clear ingested records by analysis ID */
export async function clearIngestedRecords(analysisId: string): Promise<number> {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  return ingestedRecords.clearRecords(pool, analysisId)
}

export interface StoreEdgesParams {
  analysisId: string
  edges: ReadonlyArray<Edge>
  hopDepth?: number
}

/** Persist a batch of relationship edges discovered during ingest. */
export async function storeIngestedEdges(params: StoreEdgesParams): Promise<number> {
  if (!vendor.isConfigured()) return 0
  if (params.edges.length === 0) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  return ingestedEdges.storeEdges(pool, params)
}

/** Edges originating from a specific record within a session. */
export async function getEdgesFrom(
  analysisId: string,
  srcModel: string,
  srcId: string
): Promise<ingestedEdges.EdgeRow[]> {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return ingestedEdges.getEdgesFrom(pool, analysisId, srcModel, srcId)
}

/** Bulk-load record embeddings keyed by record_id for the given records. */
export async function getEmbeddingsForRecords(
  analysisId: string,
  model: string,
  recordIds: ReadonlyArray<string>
): Promise<Map<string, Float32Array>> {
  if (!vendor.isConfigured()) return new Map()
  if (recordIds.length === 0) return new Map()

  const pool = vendor.getPool()
  if (!pool) return new Map()

  return ingestedRecords.getEmbeddingsForRecords(pool, analysisId, model, recordIds)
}

/** Bulk-load edges for many source records of a model. */
export async function getEdgesForSources(
  analysisId: string,
  srcModel: string,
  srcIds: ReadonlyArray<string>
): Promise<ingestedEdges.EdgeRow[]> {
  if (!vendor.isConfigured()) return []
  if (srcIds.length === 0) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return ingestedEdges.getEdgesForSources(pool, analysisId, srcModel, srcIds)
}

/** Clear edges by analysis ID. Symmetric with clearIngestedRecords. */
export async function clearIngestedEdges(analysisId: string): Promise<number> {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  return ingestedEdges.clearEdges(pool, analysisId)
}

export interface EnsureEmbeddingsOptions {
  fields?: string[]
  /** Cap per call. Default 500. */
  limit?: number
}

/**
 * Back-fill embeddings for records that were ingested without them.
 *
 * Invoked by analysis_query when a cluster stratifier is requested on a
 * session that has unembedded records, and by semantic-cluster summary
 * strategy from analysis_summarize.
 */
export async function ensureRecordEmbeddings(
  analysisId: string,
  model: string,
  options: EnsureEmbeddingsOptions = {}
): Promise<number> {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  const limit = options.limit ?? 500
  const pending = await ingestedRecords.getRecordsWithoutEmbeddings(pool, analysisId, model, limit)
  if (pending.length === 0) return 0

  const texts = pending.map((p) => buildEmbeddingText(p.data, { fields: options.fields }))
  const updates: Array<{ recordId: string; vector: Float32Array; text: string }> = []

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBED_BATCH_SIZE)
    const vectors = await embedBatch(slice)
    for (let j = 0; j < vectors.length; j++) {
      updates.push({
        recordId: pending[start + j]!.recordId,
        vector: vectors[j]!,
        text: slice[j]!
      })
    }
  }

  return ingestedRecords.updateRecordEmbeddings(pool, analysisId, model, updates)
}

/** Clear analysis memories by analysis ID */
export async function clearAnalysisMemories(analysisId: string): Promise<number> {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  return analysisMemories.clearMemories(pool, analysisId)
}

/**
 * Flush pending memory storage writes
 */
export async function flushVectorStorage(timeout = 5000): Promise<void> {
  return vendor.flush(timeout)
}

/**
 * Close memory storage service
 */
export async function closeVectorStorage(timeout = 5000): Promise<void> {
  return vendor.close(timeout)
}

/** Convert a tool operation to natural language text for embedding */
function operationToText(
  op: StoreOperationParams,
  toolOutput: Record<string, unknown> | null
): string {
  const { toolName, toolArgs = {} } = op

  switch (toolName) {
    case 'create_model': {
      const model = (toolArgs.model as string) || 'unknown'
      const attrs = (toolArgs.attributes as Record<string, unknown>) || {}
      const name = (attrs.name as string) || (attrs.title as string) || ''
      const nameStr = name ? ` '${name}'` : ''
      const fields = Object.entries(attrs)
        .map(([k, v]) => `${k}: ${formatValue(v)}`)
        .join(', ')
      const idSuffix = toolOutput?.id ? ` -> id: ${toolOutput.id}` : ''
      return `create_model ${model}${nameStr}. Fields: ${fields}${idSuffix}`
    }
    case 'update_model': {
      const model = (toolArgs.model as string) || 'unknown'
      const id = (toolArgs.id as string) || ''
      const attrs = (toolArgs.attributes as Record<string, unknown>) || {}
      const changed = Object.keys(attrs).join(', ')
      return `update_model ${model} '${id}'. Changed: ${changed}`
    }
    case 'delete_model': {
      const model = (toolArgs.model as string) || 'unknown'
      const id = (toolArgs.id as string) || ''
      return `delete_model ${model} '${id}'`
    }
    case 'bulk_action_models': {
      const model = (toolArgs.model as string) || 'unknown'
      const action = (toolArgs.action as string) || 'unknown'
      const count = (toolArgs.record_count as number) || 0
      return `bulk_action_models ${action} ${count} ${model} records`
    }
    default: {
      const argsStr =
        Object.keys(toolArgs).length > 0
          ? ` with args: ${JSON.stringify(toolArgs).slice(0, 200)}`
          : ''
      return `${toolName}${argsStr}`
    }
  }
}

/** Format a value for summary text */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '...' : value
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 100)
  return String(value)
}
