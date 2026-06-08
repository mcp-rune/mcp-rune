/**
 * Vector Storage Service - Vendor-Agnostic Public API
 *
 * Public facade for tool-operation memories, analysis memories, ingested
 * records, and ingested edges. Delegates all storage to a
 * `VectorStorageAdapter` (see `vector-storage-definitions.ts`) injected at
 * startup. The facade itself owns embedding generation, summary text, and
 * the periodic cleanup-sweep schedule — everything else lives in the adapter.
 *
 * When no adapter is provided, every call becomes a no-op.
 *
 * @example
 * import { initVectorStorage } from '#src/runtime/vector-storage.js'
 * import { createPgvectorAdapter } from '#src/runtime/vendor/pgvector/index.js'
 *
 * initVectorStorage({
 *   adapter: createPgvectorAdapter({ pool }),
 *   serviceName: 'mcp-server-mod',
 *   backgroundCleanupIntervalMs: 60_000
 * })
 */

import type { Edge } from '#src/mcp/analysis-layer/edge-extraction.js'
import { buildEmbeddingText } from '#src/mcp/analysis-layer/edge-extraction.js'

import { embed, embedBatch } from './embeddings.js'
import * as logger from './logger.js'
import { adaptToolOutput } from './tool-output-adapters.js'
import type {
  ClusterFilters,
  ClusterOptions,
  ClusterResult,
  EdgeRow,
  GapFilters,
  GapOptions,
  GapResult,
  IngestedDataQuery,
  OperationFilters,
  QueryOptions,
  RecallOptions,
  RecordEmbedding,
  VectorStorageAdapter
} from './vector-storage-definitions.js'

export type {
  AggregateQuery,
  AnalysisMemoriesAdapter,
  AnalysisMemoryMetadata,
  ClusterFilters,
  ClusterOptions,
  ClusterResult,
  DryRunResult,
  EdgeRow,
  FilterQuery,
  GapFilters,
  GapOptions,
  GapResult,
  GraphStratifierSpec,
  IngestedDataQuery,
  IngestedEdgesAdapter,
  IngestedRecordsAdapter,
  IngestParams,
  OperationFilters,
  OperationMetadata,
  ProximityParams,
  QueryOptions,
  RecallOptions,
  RecordEmbedding,
  SampleQuery,
  SessionDescriptor,
  SessionGraphInfo,
  StoreEdgesParams,
  TemplateEmbedding,
  ToolMemoriesAdapter,
  VectorStorageAdapter
} from './vector-storage-definitions.js'

/** Batch size for record embedding during ingest. */
const EMBED_BATCH_SIZE = 64

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

export interface StoreOperationParams {
  toolName: string
  toolArgs?: Record<string, unknown>
  toolOutput?: Record<string, unknown>
  sessionId?: string
  userId?: string
}

export interface AnalysisMemoryParams {
  analysisId: string
  finding: string
  category?: string
  metadata?: Record<string, unknown>
  persistent?: boolean
}

/**
 * Facade-facing recall filters. The `query` field is a raw text query that
 * the facade embeds before delegating to the adapter (which sees `embedding`).
 */
export interface AnalysisRecallFilters {
  analysisId?: string
  category?: string
  query?: string
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

export interface StoreEdgesFacadeParams {
  analysisId: string
  edges: ReadonlyArray<Edge>
  hopDepth?: number
}

export interface EnsureEmbeddingsOptions {
  fields?: string[]
  /** Cap per call. Default 500. */
  limit?: number
}

let activeAdapter: VectorStorageAdapter | null = null
let cleanupInterval: ReturnType<typeof setInterval> | null = null

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

  activeAdapter = options.adapter

  runCleanupSweep().catch((err: Error) => {
    logger.error('vector-storage boot cleanup failed', {
      service: 'vector-storage',
      error: err.message
    })
  })

  if (options.backgroundCleanupIntervalMs && options.backgroundCleanupIntervalMs > 0) {
    cleanupInterval = setInterval(() => {
      if (!activeAdapter) return
      runCleanupSweep().catch((err: Error) => {
        logger.error('vector-storage periodic cleanup failed', {
          service: 'vector-storage',
          error: err.message
        })
      })
    }, options.backgroundCleanupIntervalMs)
    if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref()
  }

  logger.info('vector-storage initialized', {
    service: 'vector-storage',
    serviceName: options.serviceName,
    version: options.version,
    backgroundCleanupIntervalMs: options.backgroundCleanupIntervalMs ?? null
  })

  return true
}

async function runCleanupSweep(): Promise<void> {
  if (!activeAdapter) return
  await Promise.all([
    activeAdapter.toolMemories.cleanupExpired(),
    activeAdapter.analysisMemories.cleanupExpired(),
    activeAdapter.ingestedRecords.cleanupExpired(),
    activeAdapter.ingestedEdges.cleanupExpired()
  ])
}

/** Check if vector storage is configured and enabled */
export function isVectorStorageEnabled(): boolean {
  return activeAdapter !== null
}

/**
 * Store a tool operation embedding
 *
 * Converts the operation to natural language, generates an embedding,
 * and stores both in the vector database. Fire-and-forget from callers.
 */
export async function storeOperation(operation: StoreOperationParams): Promise<string | null> {
  if (!activeAdapter) return null

  const toolOutput = adaptToolOutput(operation.toolName, operation.toolOutput, operation.toolArgs)
  const summary = operationToText(operation, toolOutput)
  const embedding = await embed(summary)

  return activeAdapter.toolMemories.storeOperation(embedding, {
    toolName: operation.toolName,
    toolArgs: operation.toolArgs,
    toolOutput,
    userId: operation.userId,
    sessionId: operation.sessionId,
    summary
  })
}

/** Find operations similar to a query */
export async function findSimilarOperations(
  query: string,
  filters: OperationFilters = {},
  options: QueryOptions = {}
): Promise<Record<string, unknown>[]> {
  if (!activeAdapter) return []
  const embedding = await embed(query)
  return activeAdapter.toolMemories.findSimilar(embedding, filters, options)
}

/** Detect gaps in operations for a record */
export async function detectOperationGaps(
  expectedSteps: string[],
  filters: GapFilters = {},
  options: GapOptions = {}
): Promise<GapResult[]> {
  if (!activeAdapter) return []

  const embeddings = await embedBatch(expectedSteps)
  const templateEmbeddings = expectedSteps.map((label, i) => ({
    label,
    embedding: embeddings[i]!
  }))

  return activeAdapter.toolMemories.detectGaps(templateEmbeddings, filters, options)
}

/** Get operation clusters grouped by semantic similarity */
export async function getOperationClusters(
  filters: ClusterFilters = {},
  options: ClusterOptions = {}
): Promise<ClusterResult> {
  if (!activeAdapter) return { clusters: [], outliers: [] }
  return activeAdapter.toolMemories.getClusters(filters, options)
}

/** Get operation statistics */
export async function getOperationStats(
  filters: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  if (!activeAdapter) return []
  return activeAdapter.toolMemories.getStats(filters)
}

/** Store an analysis memory finding */
export async function storeAnalysisMemory(params: AnalysisMemoryParams): Promise<string | null> {
  if (!activeAdapter) return null
  const embedding = await embed(params.finding)
  return activeAdapter.analysisMemories.storeMemory(embedding, params)
}

/** Recall analysis memories by filters and/or semantic query */
export async function recallAnalysisMemories(
  filters: AnalysisRecallFilters = {},
  options: RecallOptions = {}
): Promise<Record<string, unknown>[]> {
  if (!activeAdapter) return []

  const adapterFilters: { analysisId?: string; category?: string; embedding?: Float32Array } = {
    analysisId: filters.analysisId,
    category: filters.category
  }
  if (filters.query) {
    adapterFilters.embedding = await embed(filters.query)
  }

  return activeAdapter.analysisMemories.recallMemories(adapterFilters, options)
}

/** Store ingested records for analysis, optionally embedding them. */
export async function storeIngestedRecords(params: IngestRecordsParams): Promise<number> {
  if (!activeAdapter) return 0

  let embeddings: RecordEmbedding[] | undefined
  if (params.embed) {
    const fields = typeof params.embed === 'object' ? params.embed.fields : undefined
    embeddings = await _embedRecordBatch(params.records, fields)
  }

  return activeAdapter.ingestedRecords.storeRecords({
    analysisId: params.analysisId,
    model: params.model,
    records: params.records,
    embeddings
  })
}

async function _embedRecordBatch(
  records: ReadonlyArray<{ data: Record<string, unknown> }>,
  fields?: string[]
): Promise<RecordEmbedding[]> {
  const texts: string[] = records.map((r) => buildEmbeddingText(r.data, { fields }))
  const out: RecordEmbedding[] = []
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
  if (!activeAdapter) return []
  return activeAdapter.ingestedRecords.queryRecords(analysisId, query)
}

/** Surface graph dimensions for describe-mode (edge types + embedding coverage). */
export async function getSessionGraphInfo(analysisId: string) {
  if (!activeAdapter) {
    return { edgeTypes: [], embeddedRecordCount: 0, totalRecordCount: 0 }
  }
  return activeAdapter.ingestedRecords.getSessionGraphInfo(analysisId)
}

/** Describe an analysis session — returns model name and record count */
export async function describeAnalysisSession(analysisId: string) {
  if (!activeAdapter) return null
  return activeAdapter.ingestedRecords.describeSession(analysisId)
}

/** Get count of ingested records for a given analysis session and model */
export async function getIngestedRecordCount(analysisId: string, model: string): Promise<number> {
  if (!activeAdapter) return 0
  return activeAdapter.ingestedRecords.getRecordCount(analysisId, model)
}

/** Get all record IDs for a given analysis session and model */
export async function getIngestedRecordIds(analysisId: string, model: string): Promise<string[]> {
  if (!activeAdapter) return []
  return activeAdapter.ingestedRecords.getRecordIds(analysisId, model)
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
  if (!activeAdapter) return []
  return activeAdapter.ingestedRecords.getRecordIdsFiltered(analysisId, model, where)
}

/** Preview a filtered set without mutating — for analysis_act dry_run. */
export async function getIngestedRecordDryRun(
  analysisId: string,
  model: string,
  where?: Record<string, unknown>,
  sampleLimit?: number
) {
  if (!activeAdapter) {
    return {
      matchedCount: 0,
      sampleIds: [],
      sampleData: [],
      earliestIngestedAt: null,
      latestIngestedAt: null
    }
  }
  return activeAdapter.ingestedRecords.getRecordsForDryRun(analysisId, model, where, sampleLimit)
}

/** Clear ingested records by analysis ID */
export async function clearIngestedRecords(analysisId: string): Promise<number> {
  if (!activeAdapter) return 0
  return activeAdapter.ingestedRecords.clearRecords(analysisId)
}

/** Persist a batch of relationship edges discovered during ingest. */
export async function storeIngestedEdges(params: StoreEdgesFacadeParams): Promise<number> {
  if (!activeAdapter) return 0
  if (params.edges.length === 0) return 0
  return activeAdapter.ingestedEdges.storeEdges(params)
}

/** Edges originating from a specific record within a session. */
export async function getEdgesFrom(
  analysisId: string,
  srcModel: string,
  srcId: string
): Promise<EdgeRow[]> {
  if (!activeAdapter) return []
  return activeAdapter.ingestedEdges.getEdgesFrom(analysisId, srcModel, srcId)
}

/** Bulk-load record embeddings keyed by record_id for the given records. */
export async function getEmbeddingsForRecords(
  analysisId: string,
  model: string,
  recordIds: ReadonlyArray<string>
): Promise<Map<string, Float32Array>> {
  if (!activeAdapter) return new Map()
  if (recordIds.length === 0) return new Map()
  return activeAdapter.ingestedRecords.getEmbeddingsForRecords(analysisId, model, recordIds)
}

/** Bulk-load edges for many source records of a model. */
export async function getEdgesForSources(
  analysisId: string,
  srcModel: string,
  srcIds: ReadonlyArray<string>
): Promise<EdgeRow[]> {
  if (!activeAdapter) return []
  if (srcIds.length === 0) return []
  return activeAdapter.ingestedEdges.getEdgesForSources(analysisId, srcModel, srcIds)
}

/** Clear edges by analysis ID. Symmetric with clearIngestedRecords. */
export async function clearIngestedEdges(analysisId: string): Promise<number> {
  if (!activeAdapter) return 0
  return activeAdapter.ingestedEdges.clearEdges(analysisId)
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
  if (!activeAdapter) return 0

  const limit = options.limit ?? 500
  const pending = await activeAdapter.ingestedRecords.getRecordsWithoutEmbeddings(
    analysisId,
    model,
    limit
  )
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

  return activeAdapter.ingestedRecords.updateRecordEmbeddings(analysisId, model, updates)
}

/** Clear analysis memories by analysis ID */
export async function clearAnalysisMemories(analysisId: string): Promise<number> {
  if (!activeAdapter) return 0
  return activeAdapter.analysisMemories.clearMemories(analysisId)
}

/** Flush pending vector storage writes */
export async function flushVectorStorage(timeout = 5000): Promise<void> {
  if (!activeAdapter) return
  return activeAdapter.flush(timeout)
}

/** Close vector storage service */
export async function closeVectorStorage(timeout = 5000): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
  if (!activeAdapter) return
  const adapter = activeAdapter
  activeAdapter = null
  return adapter.close(timeout)
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
