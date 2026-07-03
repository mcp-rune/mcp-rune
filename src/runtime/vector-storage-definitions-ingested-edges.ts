import type { Edge } from '#src/mcp/analysis-layer/edge-extraction.js'

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

export interface EdgePathStep {
  fromModel: string
  fromId: string
  toModel: string
  toId: string
  edgeType: string
  /** `forward` follows the stored src→dst direction; `reverse` walks it backwards. */
  direction: 'forward' | 'reverse'
}

export interface EdgePath {
  steps: EdgePathStep[]
  depth: number
}

export interface FindPathsParams {
  from: { model: string; id: string }
  to: { model: string; id: string }
  /** Maximum path length in edges. Default 4, capped at 6. */
  maxDepth?: number
  /** Maximum paths returned, shortest first. Default 5, capped at 20. */
  limit?: number
}

export interface IngestedEdgesAdapter {
  storeEdges(params: StoreEdgesParams): Promise<number>
  getEdgesFrom(analysisId: string, srcModel: string, srcId: string): Promise<EdgeRow[]>
  findPaths(analysisId: string, params: FindPathsParams): Promise<EdgePath[]>
  getEdgesForSources(
    analysisId: string,
    srcModel: string,
    srcIds: ReadonlyArray<string>
  ): Promise<EdgeRow[]>
  clearEdges(analysisId: string): Promise<number>
  cleanupExpired(): Promise<number>
}
