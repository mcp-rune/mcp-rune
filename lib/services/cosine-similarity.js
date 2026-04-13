/**
 * Cosine Similarity - Shared Math Utility
 *
 * Measures angular distance between two vectors.
 * Returns 1.0 for identical direction, 0.0 for orthogonal, -1.0 for opposite.
 *
 * Used by:
 * - pgvector operations (comparing stored embeddings from database)
 * - Domain semantic search (in-memory comparison over ~60 items)
 *
 * Accepts Float32Array, number[], or JSON strings "[0.1,0.2,...]".
 *
 * @param {Float32Array|number[]|string} a - First embedding
 * @param {Float32Array|number[]|string} b - Second embedding
 * @returns {number} Cosine similarity (-1.0 to 1.0)
 */
export function cosineSimilarity(a, b) {
  const vecA = typeof a === 'string' ? JSON.parse(a) : Array.from(a)
  const vecB = typeof b === 'string' ? JSON.parse(b) : Array.from(b)

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
