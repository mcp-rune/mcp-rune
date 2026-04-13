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
 * import { embed, embedBatch, getEmbeddingDimensions } from '#lib/services/embeddings.js'
 *
 * const vector = await embed('Created deal BBC Drama Package')
 * // Float32Array(384)
 */

import * as logger from '#lib/services/logger.js'

const MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2'
const EMBEDDING_DIMENSIONS = 384

let pipeline = null
let initPromise = null

/**
 * Load the embedding model lazily
 * @returns {Promise<Function>} Feature extraction pipeline
 * @private
 */
async function getOrCreatePipeline() {
  if (pipeline) return pipeline

  if (initPromise) return initPromise

  initPromise = (async () => {
    const { pipeline: createPipeline } = await import('@huggingface/transformers')
    pipeline = await createPipeline('feature-extraction', MODEL_NAME, {
      quantized: true
    })
    logger.info('Embedding model loaded', {
      service: 'embeddings',
      model: MODEL_NAME,
      dimensions: EMBEDDING_DIMENSIONS
    })
    return pipeline
  })()

  return initPromise
}

/**
 * Pre-warm the embedding model (optional)
 *
 * Call at startup to avoid cold-start latency on first embed().
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @returns {Promise<void>}
 */
export async function initEmbeddings() {
  await getOrCreatePipeline()
}

/**
 * Embed a single text string
 *
 * @param {string} text - Text to embed
 * @returns {Promise<Float32Array>} Embedding vector (384 dimensions)
 */
export async function embed(text) {
  const extractor = await getOrCreatePipeline()
  const output = await extractor(text, { pooling: 'mean', normalize: true })
  return output.data
}

/**
 * Embed multiple texts in batch
 *
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<Float32Array[]>} Array of embedding vectors
 */
export async function embedBatch(texts) {
  const extractor = await getOrCreatePipeline()
  const results = []
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true })
    results.push(output.data)
  }
  return results
}

/**
 * Get the embedding dimensions for the current model
 *
 * @returns {number} Embedding dimensions (384)
 */
export function getEmbeddingDimensions() {
  return EMBEDDING_DIMENSIONS
}
