import { buildEmbeddingText } from '#src/mcp/analysis-layer/edge-extraction.js'

import { embedBatch } from './embeddings.js'
import type {
  IngestedDataQuery,
  RecordEmbedding,
  SessionDescriptor,
  SessionGraphInfo
} from './vector-storage-definitions-ingested-records.js'
import { getAdapter } from './vector-storage-state.js'

const EMBED_BATCH_SIZE = 64

export interface IngestRecordsParams {
  analysisId: string
  model: string
  records: Array<{ id?: string; data: Record<string, unknown> }>
  /**
   * Opt-in record embeddings. `true` embeds all string-valued attributes;
   * an object form restricts to specific fields. When omitted, the embedding
   * columns stay NULL and a later cluster-stratifier triggers back-fill via
   * ensureRecordEmbeddings.
   */
  embed?: boolean | { fields?: string[] }
}

export interface EnsureEmbeddingsOptions {
  fields?: string[]
  /** Cap per call. Default 500. */
  limit?: number
}

/** Store ingested records for analysis, optionally embedding them. */
export async function storeIngestedRecords(params: IngestRecordsParams): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0

  let embeddings: RecordEmbedding[] | undefined
  if (params.embed) {
    const fields = typeof params.embed === 'object' ? params.embed.fields : undefined
    embeddings = await _embedRecordBatch(params.records, fields)
  }

  return adapter.ingestedRecords.storeRecords({
    analysisId: params.analysisId,
    model: params.model,
    records: params.records,
    embeddings
  })
}

async function _embedRecordBatch(
  records: ReadonlyArray<{ data: Record<string, unknown> }>,
  fields?: string[]
): Promise<RecordEmbedding[]> {
  const texts: string[] = records.map((r) => buildEmbeddingText(r.data, { fields }))
  const out: RecordEmbedding[] = []
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBED_BATCH_SIZE)
    const vectors = await embedBatch(slice)
    for (let j = 0; j < vectors.length; j++) {
      out.push({ recordIndex: start + j, vector: vectors[j]!, text: slice[j]! })
    }
  }
  return out
}

/** Query ingested records (aggregate, filter, or sample) */
export async function queryIngestedData(
  analysisId: string,
  query: IngestedDataQuery
): Promise<Record<string, unknown>[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  return adapter.ingestedRecords.queryRecords(analysisId, query)
}

/** Surface graph dimensions for describe-mode (edge types + embedding coverage). */
export async function getSessionGraphInfo(analysisId: string): Promise<SessionGraphInfo> {
  const adapter = getAdapter()
  if (!adapter) {
    return { edgeTypes: [], embeddedRecordCount: 0, totalRecordCount: 0 }
  }
  return adapter.ingestedRecords.getSessionGraphInfo(analysisId)
}

/** Describe an analysis session — returns model name and record count */
export async function describeAnalysisSession(
  analysisId: string
): Promise<SessionDescriptor | null> {
  const adapter = getAdapter()
  if (!adapter) return null
  return adapter.ingestedRecords.describeSession(analysisId)
}

/** Get count of ingested records for a given analysis session and model */
export async function getIngestedRecordCount(analysisId: string, model: string): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0
  return adapter.ingestedRecords.getRecordCount(analysisId, model)
}

/** Get all record IDs for a given analysis session and model */
export async function getIngestedRecordIds(analysisId: string, model: string): Promise<string[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  return adapter.ingestedRecords.getRecordIds(analysisId, model)
}

/**
 * Get record IDs matching an optional WHERE predicate.
 *
 * Same operator vocabulary as analysis_query mode: "filter". Returns IDs only,
 * so callers (analysis_act) can resolve a mutation set server-side without
 * round-tripping rows through context.
 */
export async function getIngestedRecordIdsFiltered(
  analysisId: string,
  model: string,
  where?: Record<string, unknown>
): Promise<string[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  return adapter.ingestedRecords.getRecordIdsFiltered(analysisId, model, where)
}

/** Preview a filtered set without mutating — for analysis_act dry_run. */
export async function getIngestedRecordDryRun(
  analysisId: string,
  model: string,
  where?: Record<string, unknown>,
  sampleLimit?: number
) {
  const adapter = getAdapter()
  if (!adapter) {
    return {
      matchedCount: 0,
      sampleIds: [],
      sampleData: [],
      earliestIngestedAt: null,
      latestIngestedAt: null
    }
  }
  return adapter.ingestedRecords.getRecordsForDryRun(analysisId, model, where, sampleLimit)
}

/** Clear ingested records by analysis ID */
export async function clearIngestedRecords(analysisId: string): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0
  return adapter.ingestedRecords.clearRecords(analysisId)
}

/** Bulk-load record embeddings keyed by record_id for the given records. */
export async function getEmbeddingsForRecords(
  analysisId: string,
  model: string,
  recordIds: ReadonlyArray<string>
): Promise<Map<string, Float32Array>> {
  const adapter = getAdapter()
  if (!adapter) return new Map()
  if (recordIds.length === 0) return new Map()
  return adapter.ingestedRecords.getEmbeddingsForRecords(analysisId, model, recordIds)
}

/**
 * Back-fill embeddings for records that were ingested without them.
 *
 * Invoked by analysis_query when a cluster stratifier is requested on a
 * session that has unembedded records, and by semantic-cluster summary
 * strategy from analysis_summarize.
 */
export async function ensureRecordEmbeddings(
  analysisId: string,
  model: string,
  options: EnsureEmbeddingsOptions = {}
): Promise<number> {
  const adapter = getAdapter()
  if (!adapter) return 0

  const limit = options.limit ?? 500
  const pending = await adapter.ingestedRecords.getRecordsWithoutEmbeddings(
    analysisId,
    model,
    limit
  )
  if (pending.length === 0) return 0

  const texts = pending.map((p) => buildEmbeddingText(p.data, { fields: options.fields }))
  const updates: Array<{ recordId: string; vector: Float32Array; text: string }> = []

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const slice = texts.slice(start, start + EMBED_BATCH_SIZE)
    const vectors = await embedBatch(slice)
    for (let j = 0; j < vectors.length; j++) {
      updates.push({
        recordId: pending[start + j]!.recordId,
        vector: vectors[j]!,
        text: slice[j]!
      })
    }
  }

  return adapter.ingestedRecords.updateRecordEmbeddings(analysisId, model, updates)
}
