/**
 * Vector storage definitions — the type vocabulary describing what a vector
 * storage backend IS.
 *
 * Mirrors the role of `src/mcp/models/model-definitions.ts` for models and
 * `src/mcp/prompts/prompt-definitions.ts` for prompts: holds the contract
 * (`VectorStorageAdapter` + four sub-adapter interfaces) consumed by the
 * `vector-storage.ts` facade and by every vendor implementation under
 * `vendor/<name>/`. Definition lives here; the facade and the vendor
 * factories are consumers.
 *
 * To add a new vendor (e.g. Qdrant), create `vendor/qdrant/index.ts` exporting
 * `createQdrantAdapter(...): VectorStorageAdapter`. No edits to this file or
 * to `vector-storage.ts` should be required.
 */

import type { Edge } from '#src/mcp/analysis-layer/edge-extraction.js'

export interface OperationMetadata {
  toolName: string
  toolArgs?: Record<string, unknown>
  toolOutput?: Record<string, unknown> | null
  userId?: string
  sessionId?: string
  summary: string
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

export interface TemplateEmbedding {
  label: string
  embedding: Float32Array
}

export interface GapFilters {
  recordId?: string
  modelName?: string
}

export interface GapOptions {
  threshold?: number
}

export interface GapResult {
  step: string
  confidence: number
  status: string
}

export interface ClusterFilters {
  toolName?: string
  days?: number
}

export interface ClusterOptions {
  minClusterSize?: number
  similarityThreshold?: number
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

export interface ToolMemoriesAdapter {
  storeOperation(embedding: Float32Array, metadata: OperationMetadata): Promise<string>
  findSimilar(
    embedding: Float32Array,
    filters: OperationFilters,
    options: QueryOptions
  ): Promise<Record<string, unknown>[]>
  detectGaps(
    templateEmbeddings: ReadonlyArray<TemplateEmbedding>,
    filters: GapFilters,
    options: GapOptions
  ): Promise<GapResult[]>
  getClusters(filters: ClusterFilters, options: ClusterOptions): Promise<ClusterResult>
  getStats(filters: Record<string, unknown>): Promise<Record<string, unknown>[]>
  cleanupExpired(): Promise<number>
}

export interface AnalysisMemoryMetadata {
  analysisId: string
  finding: string
  category?: string
  metadata?: Record<string, unknown>
  persistent?: boolean
}

/**
 * Adapter-shape recall filters: the embedding has already been computed by
 * the facade when a semantic query is requested. The facade-facing analog
 * (with `query?: string`) lives in `vector-storage.ts`.
 */
export interface RecallFilters {
  analysisId?: string
  category?: string
  embedding?: Float32Array
}

export interface RecallOptions {
  topK?: number
  threshold?: number
}

export interface AnalysisMemoriesAdapter {
  storeMemory(embedding: Float32Array, metadata: AnalysisMemoryMetadata): Promise<string>
  recallMemories(filters: RecallFilters, options: RecallOptions): Promise<Record<string, unknown>[]>
  clearMemories(analysisId: string): Promise<number>
  cleanupExpired(): Promise<number>
}

export interface RecordEmbedding {
  /** Index into the `records` array this embedding corresponds to. */
  recordIndex: number
  /** Embedding vector. */
  vector: Float32Array
  /** The textification fed to the embedding model — persisted for audit/recall. */
  text: string
}

export interface IngestParams {
  analysisId: string
  model: string
  records: ReadonlyArray<{ id?: string; data: Record<string, unknown> }>
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
  /** Date/datetime field to center the proximity window on. */
  field: string
  /** Center date in ISO 8601 format (e.g., "2026-03-15"). */
  origin: string
  /** Time window around origin, e.g., "7 days", "2 weeks", "1 month". */
  window: string
  /** Bucket interval for stratification within the window (e.g., "1 day"). */
  bucket?: string
}

export type GraphStratifierSpec =
  | { kind: 'concept'; concept: string; targetModels: ReadonlyArray<string> }
  | { kind: 'edge'; edge_type: string; bucket?: 'present' | 'count' }
  | { kind: 'cluster'; k: number }

export interface SampleQuery {
  mode: 'sample'
  sampleSize?: number
  stratifyBy?: string
  where?: Record<string, unknown>
  proximity?: ProximityParams
  /**
   * Graph-aware partition dimensions composed with `where` / `proximity`
   * / `stratifyBy`. Up to 3 to bound the cross-product.
   */
  stratifiers?: ReadonlyArray<GraphStratifierSpec>
}

export type IngestedDataQuery = AggregateQuery | FilterQuery | SampleQuery

export interface SessionDescriptor {
  model: string
  totalRecords: number
}

export interface SessionGraphInfo {
  edgeTypes: string[]
  embeddedRecordCount: number
  totalRecordCount: number
}

export interface DryRunResult {
  matchedCount: number
  sampleIds: string[]
  sampleData: Array<Record<string, unknown> & { ingestedAt: string }>
  earliestIngestedAt: string | null
  latestIngestedAt: string | null
}

export interface IngestedRecordsAdapter {
  storeRecords(params: IngestParams): Promise<number>
  queryRecords(analysisId: string, query: IngestedDataQuery): Promise<Record<string, unknown>[]>
  getEmbeddingsForRecords(
    analysisId: string,
    model: string,
    recordIds: ReadonlyArray<string>
  ): Promise<Map<string, Float32Array>>
  getRecordsWithoutEmbeddings(
    analysisId: string,
    model: string,
    limit: number
  ): Promise<Array<{ recordId: string; data: Record<string, unknown> }>>
  updateRecordEmbeddings(
    analysisId: string,
    model: string,
    updates: ReadonlyArray<{ recordId: string; vector: Float32Array; text: string }>
  ): Promise<number>
  getSessionGraphInfo(analysisId: string): Promise<SessionGraphInfo>
  describeSession(analysisId: string): Promise<SessionDescriptor | null>
  getRecordCount(analysisId: string, model: string): Promise<number>
  getRecordIds(analysisId: string, model: string): Promise<string[]>
  getRecordIdsFiltered(
    analysisId: string,
    model: string,
    where?: Record<string, unknown>
  ): Promise<string[]>
  getRecordsForDryRun(
    analysisId: string,
    model: string,
    where?: Record<string, unknown>,
    sampleLimit?: number
  ): Promise<DryRunResult>
  clearRecords(analysisId: string): Promise<number>
  cleanupExpired(): Promise<number>
}

export interface StoreEdgesParams {
  analysisId: string
  edges: ReadonlyArray<Edge>
  hopDepth?: number
}

export interface EdgeRow {
  src_model: string
  src_id: string
  dst_model: string
  dst_id: string
  edge_type: string
  hop_depth: number
}

export interface IngestedEdgesAdapter {
  storeEdges(params: StoreEdgesParams): Promise<number>
  getEdgesFrom(analysisId: string, srcModel: string, srcId: string): Promise<EdgeRow[]>
  getEdgesForSources(
    analysisId: string,
    srcModel: string,
    srcIds: ReadonlyArray<string>
  ): Promise<EdgeRow[]>
  clearEdges(analysisId: string): Promise<number>
  cleanupExpired(): Promise<number>
}

/**
 * Root contract — composes the four sub-adapters plus process-lifecycle hooks.
 * Vendor factories (e.g. `createPgvectorAdapter`) return an object satisfying
 * this interface; the facade keeps a single reference and dispatches every
 * public call through it.
 */
export interface VectorStorageAdapter {
  readonly toolMemories: ToolMemoriesAdapter
  readonly analysisMemories: AnalysisMemoriesAdapter
  readonly ingestedRecords: IngestedRecordsAdapter
  readonly ingestedEdges: IngestedEdgesAdapter
  /** Drain any buffered writes. May be a no-op for synchronous backends. */
  flush(timeoutMs: number): Promise<void>
  /** Release any per-adapter resources. Pool/client lifecycle stays with the integrator. */
  close(timeoutMs: number): Promise<void>
}
