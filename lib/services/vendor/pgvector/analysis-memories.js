/**
 * pgvector Analysis Memories - Store, Recall, and Cleanup
 *
 * Supports the map-reduce pattern for large-scale qualitative analysis.
 * Findings are stored with embeddings for semantic recall and can be
 * ephemeral (auto-expire after 1 hour) or persistent.
 *
 * All functions receive the pg pool as the first argument.
 */

/**
 * Store an analysis finding with embedding
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Float32Array} embedding - Embedding vector
 * @param {Object} metadata - Finding metadata
 * @param {string} metadata.analysisId - Analysis session identifier
 * @param {string} metadata.finding - The finding text
 * @param {string} [metadata.category] - Finding category
 * @param {Object} [metadata.metadata] - Additional structured metadata
 * @param {boolean} [metadata.persistent=false] - Whether finding survives expiration
 * @returns {Promise<string>} Inserted record ID
 */
export async function storeMemory(pool, embedding, metadata) {
  const vectorStr = `[${Array.from(embedding).join(',')}]`

  const result = await pool.query(
    `INSERT INTO analysis_memories
      (analysis_id, finding, category, metadata, embedding, persistent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      metadata.analysisId,
      metadata.finding,
      metadata.category || null,
      metadata.metadata ? JSON.stringify(metadata.metadata) : '{}',
      vectorStr,
      metadata.persistent || false,
      metadata.persistent ? null : new Date(Date.now() + 60 * 60 * 1000) // 1 hour default
    ]
  )

  return result.rows[0].id
}

/**
 * Recall analysis memories by analysis ID and/or semantic query
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Object} filters - Recall filters
 * @param {string} [filters.analysisId] - Filter by analysis ID
 * @param {string} [filters.category] - Filter by category
 * @param {Float32Array} [filters.embedding] - Semantic query embedding
 * @param {Object} options - Query options
 * @param {number} [options.topK=50] - Max results
 * @param {number} [options.threshold=0.5] - Min similarity (for semantic queries)
 * @param {boolean} [options.includeSimilarity=false] - Include similarity scores
 * @returns {Promise<Object[]>} Recalled memories
 */
export async function recallMemories(pool, filters = {}, options = {}) {
  const topK = options.topK || 50

  // Evict expired rows on access
  await cleanupExpired(pool)

  const conditions = ['(persistent = TRUE OR expires_at > NOW())']
  const params = []
  let paramIdx = 1

  if (filters.analysisId) {
    conditions.push(`analysis_id = $${paramIdx++}`)
    params.push(filters.analysisId)
  }
  if (filters.category) {
    conditions.push(`category = $${paramIdx++}`)
    params.push(filters.category)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  // Semantic query mode
  if (filters.embedding) {
    const vectorStr = `[${Array.from(filters.embedding).join(',')}]`
    params.push(vectorStr)
    const vectorParam = `$${paramIdx++}`
    params.push(topK)
    const limitParam = `$${paramIdx}`

    const result = await pool.query(
      `SELECT id, analysis_id, finding, category, metadata,
              persistent, created_at,
              1 - (embedding <=> ${vectorParam}) AS similarity
       FROM analysis_memories
       ${whereClause}
       ORDER BY embedding <=> ${vectorParam}
       LIMIT ${limitParam}`,
      params
    )

    const threshold = options.threshold || 0.5
    return result.rows.filter((row) => row.similarity >= threshold).map(formatMemory)
  }

  // ID-based query mode
  params.push(topK)
  const limitParam = `$${paramIdx}`

  const result = await pool.query(
    `SELECT id, analysis_id, finding, category, metadata,
            persistent, created_at
     FROM analysis_memories
     ${whereClause}
     ORDER BY created_at ASC
     LIMIT ${limitParam}`,
    params
  )

  return result.rows.map(formatMemory)
}

/**
 * Clear analysis memories by analysis ID
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {string} analysisId - Analysis ID to clear
 * @returns {Promise<number>} Number of deleted rows
 */
export async function clearMemories(pool, analysisId) {
  const result = await pool.query(`DELETE FROM analysis_memories WHERE analysis_id = $1`, [
    analysisId
  ])
  return result.rowCount
}

/**
 * Delete expired analysis memories (on-access eviction)
 *
 * @param {pg.Pool} pool - Connection pool
 * @returns {Promise<number>} Number of deleted rows
 */
export async function cleanupExpired(pool) {
  const result = await pool.query(
    `DELETE FROM analysis_memories
     WHERE persistent = FALSE AND expires_at < NOW()`
  )
  return result.rowCount
}

/**
 * Format a memory row for output
 * @param {Object} row - Database row
 * @returns {Object} Formatted memory
 * @private
 */
function formatMemory(row) {
  const memory = {
    id: row.id,
    analysisId: row.analysis_id,
    finding: row.finding,
    createdAt: row.created_at
  }
  if (row.category) memory.category = row.category
  if (row.metadata && Object.keys(row.metadata).length > 0) memory.metadata = row.metadata
  if (row.persistent) memory.persistent = true
  if (row.similarity !== undefined) memory.similarity = parseFloat(row.similarity)
  return memory
}
