/**
 * Embedding Service - Shared Utility
 *
 * Generates text embeddings using a local model (all-MiniLM-L6-v2).
 * Not vendor-specific — any vector storage backend uses this to produce embeddings.
 *
 * Uses @huggingface/transformers for local inference:
 * - 384 dimensions, no API keys required
 * - Model downloaded on first use, cached thereafter
 * - Lazy-loaded: no startup cost until first embed() call
 *
 * @example
 * import { embed, embedBatch, getEmbeddingDimensions } from '#src/services/embeddings.js'
 *
 * const vector = await embed('Created deal BBC Drama Package')
 * // Float32Array(384)
 */

import * as logger from '#src/services/logger.js'

const MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2'
const EMBEDDING_DIMENSIONS = 384

type FeatureExtractionPipeline = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>

let pipeline: FeatureExtractionPipeline | null = null
let initPromise: Promise<FeatureExtractionPipeline> | null = null

/** Load the embedding model lazily */
async function getOrCreatePipeline(): Promise<FeatureExtractionPipeline> {
  if (pipeline) return pipeline

  if (initPromise) return initPromise

  initPromise = (async () => {
    const { pipeline: createPipeline } = await import('@huggingface/transformers')
    const p = await (createPipeline as Function)('feature-extraction', MODEL_NAME, {
      quantized: true
    }) as FeatureExtractionPipeline
    pipeline = p
    logger.info('Embedding model loaded', {
      service: 'embeddings',
      model: MODEL_NAME,
      dimensions: EMBEDDING_DIMENSIONS
    })
    return p
  })()

  return initPromise
}

/**
 * Pre-warm the embedding model (optional)
 *
 * Call at startup to avoid cold-start latency on first embed().
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initEmbeddings(): Promise<void> {
  await getOrCreatePipeline()
}

/** Embed a single text string */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getOrCreatePipeline()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  return output.data
}

/** Embed multiple texts in batch */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getOrCreatePipeline()
  const results: Float32Array[] = []
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true })
    results.push(output.data)
  }
  return results
}

/** Get the embedding dimensions for the current model */
export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS
}
