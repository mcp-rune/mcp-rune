/**
 * Reranking Service — local cross-encoder relevance scoring.
 *
 * The bi-encoder embedding recall (`embeddings.ts` + pgvector cosine) is fast
 * but coarse: it scores query and document independently. A cross-encoder
 * scores the (query, document) pair jointly, which is far more precise but too
 * slow to run over a whole corpus. The standard fix is two-stage retrieval:
 * over-fetch a candidate pool by cosine, then rerank that small pool with the
 * cross-encoder and cut to the final `topK` (ADR 0018).
 *
 * Runs entirely locally through the already-optional `@huggingface/transformers`
 * dependency — no API key, deterministic inference. Lazy-loaded: no cost until
 * the first `rerank()` call, and callers that never opt in never pull the model.
 *
 * @example
 * import { rerank, isRerankingAvailable } from '#src/runtime/reranking.js'
 *
 * const scores = await rerank('unread sci-fi novels', ['Dune (unread)', 'Clean Code (read)'])
 * // scores[i] is the cross-encoder relevance of document i; higher is better.
 */

import * as logger from '#src/runtime/logger.js'

const MODEL_NAME = 'Xenova/ms-marco-MiniLM-L-6-v2'

type TextPair = { text: string; text_pair: string }
type ClassificationResult = { label: string; score: number }
type TextClassificationPipeline = (
  input: TextPair | TextPair[],
  options?: { top_k?: number }
) => Promise<ClassificationResult | ClassificationResult[] | ClassificationResult[][]>

let pipeline: TextClassificationPipeline | null = null
let initPromise: Promise<TextClassificationPipeline | null> | null = null

/** Load the cross-encoder lazily. Returns null if transformers is unavailable. */
async function getOrCreatePipeline(): Promise<TextClassificationPipeline | null> {
  if (pipeline) return pipeline
  if (initPromise) return initPromise

  initPromise = (async () => {
    let createPipeline: unknown
    try {
      ;({ pipeline: createPipeline } = await import('@huggingface/transformers'))
    } catch {
      logger.warn(
        'Reranking requested but @huggingface/transformers is not installed; ' +
          'falling back to embedding-cosine order.',
        { service: 'reranking' }
      )
      return null
    }
    const p = await (
      createPipeline as unknown as (
        task: string,
        model: string,
        options: { quantized: boolean }
      ) => Promise<TextClassificationPipeline>
    )('text-classification', MODEL_NAME, { quantized: true })
    pipeline = p
    logger.info('Reranking model loaded', { service: 'reranking', model: MODEL_NAME })
    return p
  })()

  return initPromise
}

/** Pre-warm the cross-encoder (optional). */
export async function initReranking(): Promise<void> {
  await getOrCreatePipeline()
}

/** Whether the cross-encoder can be loaded (transformers dependency present). */
export async function isRerankingAvailable(): Promise<boolean> {
  return (await getOrCreatePipeline()) !== null
}

/**
 * Score each document's relevance to the query with the cross-encoder. Returns
 * one score per input document, in input order; higher means more relevant.
 * Returns an empty array when reranking is unavailable so callers can fall back
 * to their prior ordering.
 */
export async function rerank(query: string, documents: string[]): Promise<number[]> {
  if (documents.length === 0) return []
  const extractor = await getOrCreatePipeline()
  if (!extractor) return []

  const pairs: TextPair[] = documents.map((doc) => ({ text: query, text_pair: doc }))
  const raw = await extractor(pairs)

  // The pipeline returns one classification per pair (an array of results, or a
  // nested array when top_k expands each). Normalize to a single score per doc.
  const perDoc: ClassificationResult[] = Array.isArray(raw)
    ? raw.map((r) => (Array.isArray(r) ? r[0]! : r))
    : [raw as ClassificationResult]

  return documents.map((_, i) => perDoc[i]?.score ?? 0)
}
