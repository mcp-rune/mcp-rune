/**
 * Built-in `semantic-cluster` strategy.
 *
 * Client-side anchor-nearest clustering over a page's record embeddings.
 * Picks `k` anchors at random, assigns each record to its nearest anchor by
 * cosine similarity (embeddings are normalized, so dot product is enough),
 * reports per-cluster size + representative record (the one closest to the
 * anchor) + mean intra-cluster distance.
 *
 * Complementary to the SQL `cluster` stratifier: that one runs server-side
 * for sampling; this one runs client-side over the page so the LLM gets a
 * narrative summary of natural groupings without needing a sample query.
 *
 * Skips silently when the dispatcher didn't supply embeddings or when fewer
 * than `k` records have embeddings.
 */

import type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const DEFAULT_K = 5
const REP_TEXT_HINT_FIELDS = ['title', 'name', 'subject']

interface ClusterInfo {
  size: number
  representative_id: string
  representative_hint: string | null
  mean_distance: number
  member_ids: string[]
}

export const semanticClusterStrategy: SummaryStrategy = {
  name: 'semantic-cluster',
  description:
    'Anchor-nearest clustering over record embeddings (k from options.k, default 5). Reports cluster sizes, representative records, and mean intra-cluster distance. Requires embed_records: true at ingest (or auto-back-fill at query time).',
  requires: ['embeddings'],
  appliesTo(input: SummaryInput): boolean {
    if (input.records.length === 0) return false
    if (!input.embeddings || input.embeddings.size === 0) return false
    const k = readK(input)
    return input.embeddings.size >= k
  },
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const embeddings = input.embeddings!
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`
    const k = readK(input)

    // Stable subset: records that actually have embeddings
    const embeddedRecords: Array<{
      id: string
      vec: Float32Array
      record: Record<string, unknown>
    }> = []
    for (const r of records) {
      if (r.id == null) continue
      const vec = embeddings.get(String(r.id))
      if (vec) embeddedRecords.push({ id: String(r.id), vec, record: r })
    }

    // Anchor selection — deterministic-ish via record order + a small jitter index.
    // Strategies must be deterministic for the same input; we honor that by
    // taking the first `k` records as anchors. (For Phase 4 docs we may swap
    // in a seeded shuffle controlled by options.seed.)
    const anchors = embeddedRecords.slice(0, k)

    // Assign every embedded record to its nearest anchor
    const clusters: Map<
      number,
      Array<{ id: string; record: Record<string, unknown>; dist: number }>
    > = new Map()
    for (let a = 0; a < anchors.length; a++) clusters.set(a, [])

    for (const item of embeddedRecords) {
      let bestIdx = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (let a = 0; a < anchors.length; a++) {
        const dist = cosineDistance(item.vec, anchors[a]!.vec)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = a
        }
      }
      clusters.get(bestIdx)!.push({ id: item.id, record: item.record, dist: bestDist })
    }

    const summary: Record<string, ClusterInfo> = {}
    const lines: string[] = []

    for (let a = 0; a < anchors.length; a++) {
      const members = clusters.get(a)!
      if (members.length === 0) continue
      members.sort((x, y) => x.dist - y.dist)
      const rep = members[0]!
      const meanDist = members.reduce((acc, m) => acc + m.dist, 0) / Math.max(1, members.length)

      summary[`cluster_${a + 1}`] = {
        size: members.length,
        representative_id: rep.id,
        representative_hint: hintFor(rep.record),
        mean_distance: Number(meanDist.toFixed(4)),
        member_ids: members.map((m) => m.id)
      }

      lines.push(
        `cluster ${a + 1} (size ${members.length}, mean dist ${meanDist.toFixed(2)}): rep ${rep.id}` +
          (hintFor(rep.record) ? ` "${hintFor(rep.record)}"` : '')
      )
    }

    const finding =
      `Page ${pageLabel} of ${model} records (${total} records, ${embeddedRecords.length} embedded). ` +
      (lines.length > 0
        ? `Semantic clusters (k=${k}): ${lines.join('. ')}.`
        : 'No semantic clusters produced (insufficient embedded records).')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: total,
        embedded_count: embeddedRecords.length,
        k,
        clusters: summary
      }
    }
  }
}

function readK(input: SummaryInput): number {
  const raw = input.options?.k
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 2 && raw <= 20) {
    return raw
  }
  return DEFAULT_K
}

/** Cosine distance for normalized embeddings = 1 - dot product. */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return 1 - dot
}

function hintFor(record: Record<string, unknown>): string | null {
  for (const field of REP_TEXT_HINT_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 60 ? value.slice(0, 57) + '...' : value
    }
  }
  return null
}
