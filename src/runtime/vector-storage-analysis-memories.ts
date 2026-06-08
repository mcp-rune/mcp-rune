import { embed } from './embeddings.js'
import type { RecallOptions } from './vector-storage-definitions-analysis-memories.js'
import { getAdapter } from './vector-storage-state.js'

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

/** Store an analysis memory finding */
export async function storeAnalysisMemory(params: AnalysisMemoryParams): Promise<string | null> {
  const adapter = getAdapter()
  if (!adapter) return null
  const embedding = await embed(params.finding)
  return adapter.analysisMemories.storeMemory(embedding, params)
}

/** Recall analysis memories by filters and/or semantic query */
export async function recallAnalysisMemories(
  filters: AnalysisRecallFilters = {},
  options: RecallOptions = {}
): Promise<Record<string, unknown>[]> {
  const adapter = getAdapter()
  if (!adapter) return []

  const adapterFilters: { analysisId?: string; category?: string; embedding?: Float32Array } = {
    analysisId: filters.analysisId,
    category: filters.category
  }
  if (filters.query) {
    adapterFilters.embedding = await embed(filters.query)
  }

  return adapter.analysisMemories.recallMemories(adapterFilters, options)
}

/** Clear analysis memories by analysis ID */
export async function clearAnalysisMemories(analysisId: string): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0
  return adapter.analysisMemories.clearMemories(analysisId)
}
