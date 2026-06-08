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
