/**
 * Built-in `relationship-coverage` strategy: per-edge-type stats over the
 * edges discovered by analysis_ingest. Reports coverage %, mean/max degree,
 * and lists records that have NO outgoing edge of each type.
 *
 * Complementary to entity-extraction: that strategy scans JSONB *_id fields
 * directly and misses `hasMany` array references that this one catches
 * because it reads from the persisted edge table.
 *
 * `appliesTo` skips when the dispatcher didn't supply edges (e.g. when
 * analysis_summarize is called without edge loading).
 */

import type { SummaryEdge, SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const GAP_LIMIT = 10

interface EdgeTypeStat {
  total: number
  unique_sources: number
  coverage_pct: number
  mean_degree: number
  max_degree: number
  target_models: Record<string, number>
  gap_ids: string[]
}

export const relationshipCoverageStrategy: SummaryStrategy = {
  name: 'relationship-coverage',
  description:
    'Per-edge-type stats from the persisted ingested_edges table: coverage %, mean/max degree, gap records. Catches hasMany references entity-extraction misses.',
  requires: ['edges'],
  appliesTo(input: SummaryInput): boolean {
    return !!input.edges && input.records.length > 0
  },
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const edges = input.edges ?? []
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`

    const recordIds = new Set<string>()
    for (const r of records) {
      if (r.id != null) recordIds.add(String(r.id))
    }

    // Bucket edges by edge_type
    const byType = new Map<string, SummaryEdge[]>()
    for (const edge of edges) {
      if (!recordIds.has(edge.src_id)) continue
      const list = byType.get(edge.edge_type)
      if (list) list.push(edge)
      else byType.set(edge.edge_type, [edge])
    }

    const stats: Record<string, EdgeTypeStat> = {}
    const lines: string[] = []

    for (const [edgeType, typeEdges] of byType) {
      const perSource = new Map<string, number>()
      const targetModels: Record<string, number> = {}
      for (const e of typeEdges) {
        perSource.set(e.src_id, (perSource.get(e.src_id) ?? 0) + 1)
        targetModels[e.dst_model] = (targetModels[e.dst_model] ?? 0) + 1
      }
      const sources = perSource.size
      const degrees = Array.from(perSource.values())
      const meanDeg = degrees.reduce((a, b) => a + b, 0) / Math.max(1, degrees.length)
      const maxDeg = degrees.reduce((a, b) => Math.max(a, b), 0)

      const gapIds: string[] = []
      for (const id of recordIds) {
        if (!perSource.has(id)) {
          gapIds.push(id)
          if (gapIds.length >= GAP_LIMIT) break
        }
      }

      stats[edgeType] = {
        total: typeEdges.length,
        unique_sources: sources,
        coverage_pct: Math.round((sources / Math.max(1, total)) * 100),
        mean_degree: Number(meanDeg.toFixed(2)),
        max_degree: maxDeg,
        target_models: targetModels,
        gap_ids: gapIds
      }

      const targetSummary = Object.entries(targetModels)
        .map(([m, n]) => `${m}=${n}`)
        .join(',')
      lines.push(
        `${edgeType}: ${sources}/${total} sources (${stats[edgeType]!.coverage_pct}%)` +
          `, mean degree ${stats[edgeType]!.mean_degree}, max ${maxDeg}, targets [${targetSummary}]`
      )
    }

    const finding =
      `Page ${pageLabel} of ${model} records (${total} records). ` +
      (lines.length > 0
        ? `Edges: ${lines.join('. ')}.`
        : 'No edges recorded for this page (multi-hop ingest may have been disabled).')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: total,
        edge_types: stats
      }
    }
  }
}
