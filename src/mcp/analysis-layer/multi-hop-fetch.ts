/**
 * Multi-Hop Fetch — BFS-walk a model's declared `belongsTo` associations
 * to expand a root set of records into their connected graph, fetching via
 * DataLayer.
 *
 *   class Episode extends BaseModel {
 *     static associations = {
 *       belongsTo: { title:    { target_model: 'title'    },         // hop 1: episode.title_id    → title
 *                    platform: { target_model: 'platform' } }        // hop 1: episode.platform_id → platform
 *     }
 *   }
 *   class Title extends BaseModel {
 *     static associations = { belongsTo: { studio: { target_model: 'studio' } } }   // hop 2: title.studio_id → studio
 *   }
 *
 *   expandHops([episode1, episode2], { maxDepth: 2, hopFollow: 'declared' })
 *     yields → { model: 'title',    records: [...] }   // hop 1
 *              { model: 'platform', records: [...] }   // hop 1
 *              { model: 'studio',   records: [...] }   // hop 2
 *
 * Cycle-safe via a shared visited Set. Per-hop fan-out is capped so a
 * runaway graph can't explode ingest cost. Composes `extractEdgesFromRecord`
 * (to find destination IDs) with `DataLayer.find` (to materialize each
 * destination record). Reached through `analysisLayer.walkHops(roots, options)`
 * after PR2.
 */

import type { DataLayer, ModelConfig, ModelsRegistry } from '#src/mcp/tools/base-tool.js'

import { type Edge, extractEdgesFromRecord, type HopFollow } from './edge-extraction.js'

export interface HopOptions {
  /** Maximum BFS depth. 0 = no hops, only edges at depth 0. */
  maxDepth: number
  /** What counts as a follow-able edge. */
  hopFollow: HopFollow
  /** When set, restrict traversal to these destination models. */
  modelWhitelist?: ReadonlyArray<string>
  /** Cap on destination IDs followed per (model, hop). Default 100. */
  perHopFanOut?: number
  /** Concurrency cap for DataLayer.find calls. Default 5. */
  concurrency?: number
}

export interface HopBatch {
  /** Destination model name. */
  model: string
  /** Records fetched at this hop. */
  records: Array<Record<string, unknown>>
  /** 1-based depth. */
  depth: number
  /** Edges discovered from these records (extracted before recursion). */
  edges: ReadonlyArray<Edge>
}

/**
 * BFS-expand a root record set across declared associations.
 *
 * Yields one HopBatch per (model, depth) tuple as records are fetched. The
 * caller is responsible for persisting records + edges between yields.
 */
export async function* expandHops(
  dataLayer: DataLayer,
  models: ModelsRegistry,
  modelConfigs: Record<string, ModelConfig>,
  rootModel: string,
  rootRecords: ReadonlyArray<Record<string, unknown>>,
  options: HopOptions
): AsyncGenerator<HopBatch> {
  if (options.maxDepth <= 0) return

  const visited = new Set<string>()
  for (const record of rootRecords) {
    if (record.id != null) visited.add(`${rootModel}:${record.id}`)
  }

  const perHopFanOut = options.perHopFanOut ?? 100
  const concurrency = options.concurrency ?? 5
  const whitelist = options.modelWhitelist ? new Set(options.modelWhitelist) : null

  let currentDepth = 0
  let frontiers = collectFrontiers(
    rootRecords,
    rootModel,
    modelConfigs[rootModel],
    options.hopFollow,
    visited,
    whitelist
  )

  while (currentDepth < options.maxDepth && frontiers.size > 0) {
    currentDepth++
    const nextFrontiers = new Map<string, Set<string>>()

    for (const [model, idSet] of frontiers) {
      if (!modelConfigs[model]) continue

      const ids = Array.from(idSet).slice(0, perHopFanOut)
      const fetched = await _findMany(dataLayer, model, ids, concurrency)
      if (fetched.length === 0) continue

      const associations = modelConfigs[model]?.associations
      const batchEdges: Edge[] = []
      for (const record of fetched) {
        const edges = extractEdgesFromRecord(record, associations, model, {
          hopFollow: options.hopFollow
        })
        batchEdges.push(...edges)
      }

      yield { model, records: fetched, depth: currentDepth, edges: batchEdges }

      if (currentDepth < options.maxDepth) {
        for (const edge of batchEdges) {
          if (whitelist && !whitelist.has(edge.dst_model)) continue
          if (!modelConfigs[edge.dst_model]) continue
          const key = `${edge.dst_model}:${edge.dst_id}`
          if (visited.has(key)) continue
          visited.add(key)
          if (!nextFrontiers.has(edge.dst_model)) {
            nextFrontiers.set(edge.dst_model, new Set())
          }
          nextFrontiers.get(edge.dst_model)!.add(edge.dst_id)
        }
      }
    }

    frontiers = nextFrontiers
  }
}

function collectFrontiers(
  records: ReadonlyArray<Record<string, unknown>>,
  sourceModel: string,
  modelConfig: ModelConfig | undefined,
  hopFollow: HopFollow,
  visited: Set<string>,
  whitelist: Set<string> | null
): Map<string, Set<string>> {
  const frontiers = new Map<string, Set<string>>()
  if (!modelConfig) return frontiers

  for (const record of records) {
    const edges = extractEdgesFromRecord(record, modelConfig.associations, sourceModel, {
      hopFollow
    })
    for (const edge of edges) {
      if (whitelist && !whitelist.has(edge.dst_model)) continue
      const key = `${edge.dst_model}:${edge.dst_id}`
      if (visited.has(key)) continue
      visited.add(key)
      if (!frontiers.has(edge.dst_model)) {
        frontiers.set(edge.dst_model, new Set())
      }
      frontiers.get(edge.dst_model)!.add(edge.dst_id)
    }
  }
  return frontiers
}

/** Fetch multiple records by ID with a concurrency cap, silently skipping failures. */
async function _findMany(
  dataLayer: DataLayer,
  model: string,
  ids: ReadonlyArray<string>,
  concurrency: number
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  let next = 0

  async function worker(): Promise<void> {
    while (next < ids.length) {
      const i = next++
      const id = ids[i]!
      try {
        const result = await dataLayer.find(model, id)
        const record = extractRecordFromFindResult(result)
        if (record) out.push(record)
      } catch {
        // Silent skip — a missing or inaccessible record is not a fatal error
        // for graph expansion; the edge to it still exists in ingested_edges.
      }
    }
  }

  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, ids.length) }, () => worker())
  )

  return out
}

/**
 * DataLayer.find returns a convention-shaped envelope. Pull out the inner
 * record. Common shapes: `{ data: {...} }` (JSON:API), `{ <model>: {...} }`,
 * or the bare record itself.
 */
function extractRecordFromFindResult(
  result: Record<string, unknown>
): Record<string, unknown> | null {
  if (result.id != null) return result
  if (typeof result.data === 'object' && result.data !== null) {
    const data = result.data as Record<string, unknown>
    if (data.id != null) return data
    if (typeof data.attributes === 'object' && data.attributes !== null) {
      return { id: data.id, ...(data.attributes as Record<string, unknown>) }
    }
  }
  // Fall back to first object value
  for (const value of Object.values(result)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>
      if (rec.id != null) return rec
    }
  }
  return null
}
