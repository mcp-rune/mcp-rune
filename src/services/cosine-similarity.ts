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
 */
export function cosineSimilarity(a: Float32Array | number[] | string, b: Float32Array | number[] | string): number {
  const vecA: number[] = typeof a === 'string' ? JSON.parse(a) : Array.from(a)
  const vecB: number[] = typeof b === 'string' ? JSON.parse(b) : Array.from(b)

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    const ai = vecA[i]!
    const bi = vecB[i]!
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
