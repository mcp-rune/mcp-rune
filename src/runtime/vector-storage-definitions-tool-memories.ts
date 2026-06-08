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
