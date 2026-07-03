import type { Edge } from '#src/mcp/analysis-layer/edge-extraction.js'

import type {
  EdgePath,
  EdgeRow,
  FindPathsParams
} from './vector-storage-definitions-ingested-edges.js'
import { getAdapter } from './vector-storage-state.js'

export interface StoreEdgesFacadeParams {
  analysisId: string
  edges: ReadonlyArray<Edge>
  hopDepth?: number
}

/** Persist a batch of relationship edges discovered during ingest. */
export async function storeIngestedEdges(params: StoreEdgesFacadeParams): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0
  if (params.edges.length === 0) return 0
  return adapter.ingestedEdges.storeEdges(params)
}

/** Edges originating from a specific record within a session. */
export async function getEdgesFrom(
  analysisId: string,
  srcModel: string,
  srcId: string
): Promise<EdgeRow[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  return adapter.ingestedEdges.getEdgesFrom(analysisId, srcModel, srcId)
}

/**
 * Shortest typed paths between two records in the session's edge graph —
 * "how is A connected to B", answered with edge chains whose types come
 * from the model declarations.
 */
export async function findEdgePaths(
  analysisId: string,
  params: FindPathsParams
): Promise<EdgePath[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  return adapter.ingestedEdges.findPaths(analysisId, params)
}

/** Bulk-load edges for many source records of a model. */
export async function getEdgesForSources(
  analysisId: string,
  srcModel: string,
  srcIds: ReadonlyArray<string>
): Promise<EdgeRow[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  if (srcIds.length === 0) return []
  return adapter.ingestedEdges.getEdgesForSources(analysisId, srcModel, srcIds)
}

/** Clear edges by analysis ID. Symmetric with clearIngestedRecords. */
export async function clearIngestedEdges(analysisId: string): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0
  return adapter.ingestedEdges.clearEdges(analysisId)
}
