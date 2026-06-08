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
