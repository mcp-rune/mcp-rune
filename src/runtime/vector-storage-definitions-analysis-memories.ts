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
 * (with `query?: string`) lives in `vector-storage-analysis-memories.ts`.
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
