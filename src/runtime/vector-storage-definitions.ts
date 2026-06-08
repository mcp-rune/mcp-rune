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

export type {
  AnalysisMemoriesAdapter,
  AnalysisMemoryMetadata,
  RecallFilters,
  RecallOptions
} from './vector-storage-definitions-analysis-memories.js'
export type {
  EdgeRow,
  IngestedEdgesAdapter,
  StoreEdgesParams
} from './vector-storage-definitions-ingested-edges.js'
export type {
  AggregateQuery,
  DryRunResult,
  FilterQuery,
  GraphStratifierSpec,
  IngestedDataQuery,
  IngestedRecordsAdapter,
  IngestParams,
  ProximityParams,
  RecordEmbedding,
  SampleQuery,
  SessionDescriptor,
  SessionGraphInfo
} from './vector-storage-definitions-ingested-records.js'
export type {
  ClusterFilters,
  ClusterOptions,
  ClusterResult,
  GapFilters,
  GapOptions,
  GapResult,
  OperationFilters,
  OperationMetadata,
  QueryOptions,
  TemplateEmbedding,
  ToolMemoriesAdapter
} from './vector-storage-definitions-tool-memories.js'

import type { AnalysisMemoriesAdapter } from './vector-storage-definitions-analysis-memories.js'
import type { IngestedEdgesAdapter } from './vector-storage-definitions-ingested-edges.js'
import type { IngestedRecordsAdapter } from './vector-storage-definitions-ingested-records.js'
import type { ToolMemoriesAdapter } from './vector-storage-definitions-tool-memories.js'

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
