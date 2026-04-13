/**
 * pgvector Tool Memories - Store, Query, and Cleanup
 *
 * Implements the vendor contract that memory-storage.js delegates to.
 * All functions receive the pg pool as the first argument.
 */

import { cosineSimilarity } from '../../cosine-similarity.js'

/**
 * Store a tool memory embedding
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Float32Array} embedding - Embedding vector
 * @param {Object} metadata - Operation metadata
 * @param {string} metadata.toolName - Tool name (e.g., 'create_model')
 * @param {Object} [metadata.toolArgs] - Tool arguments
 * @param {Object} [metadata.toolOutput] - Adapted tool output (compact JSONB)
 * @param {string} [metadata.userId] - User ID
 * @param {string} [metadata.sessionId] - MCP session ID
 * @param {string} metadata.summary - Natural language summary
 * @returns {Promise<string>} Inserted record ID
 */
export async function storeOperation(pool, embedding, metadata) {
  const vectorStr = `[${Array.from(embedding).join(',')}]`

  const result = await pool.query(
    `INSERT INTO tool_memories
      (embedding, tool_name, tool_args, user_id, session_id, summary, tool_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      vectorStr,
      metadata.toolName,
      metadata.toolArgs ? JSON.stringify(metadata.toolArgs) : null,
      metadata.userId || null,
      metadata.sessionId || null,
      metadata.summary,
      metadata.toolOutput ? JSON.stringify(metadata.toolOutput) : null
    ]
  )

  return result.rows[0].id
}

/**
 * Find similar tool memories by embedding
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Float32Array} embedding - Query embedding
 * @param {Object} filters - Search filters
 * @param {string} [filters.toolName] - Filter by tool name
 * @param {number} [filters.days] - Limit to last N days
 * @param {string} [filters.sessionId] - Filter by session
 * @param {Object} options - Query options
 * @param {number} [options.topK=10] - Max results
 * @param {number} [options.threshold=0.5] - Min similarity threshold
 * @returns {Promise<Object[]>} Ranked results with similarity scores
 */
export async function findSimilar(pool, embedding, filters = {}, options = {}) {
  const topK = options.topK || 10
  const threshold = options.threshold || 0.5
  const vectorStr = `[${Array.from(embedding).join(',')}]`

  const conditions = []
  const params = [vectorStr]
  let paramIdx = 2

  if (filters.toolName) {
    conditions.push(`tool_name = $${paramIdx++}`)
    params.push(filters.toolName)
  }
  if (filters.days) {
    conditions.push(`created_at > NOW() - INTERVAL '${parseInt(filters.days, 10)} days'`)
  }
  if (filters.sessionId) {
    conditions.push(`session_id = $${paramIdx++}`)
    params.push(filters.sessionId)
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  params.push(topK)

  const result = await pool.query(
    `SELECT id, tool_name, tool_args, tool_output, session_id,
            summary, created_at,
            1 - (embedding <=> $1) AS similarity
     FROM tool_memories
     ${whereClause}
     ORDER BY embedding <=> $1
     LIMIT $${paramIdx}`,
    params
  )

  return result.rows.filter((row) => row.similarity >= threshold)
}

/**
 * Detect gaps between actual operations and expected workflow steps
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Object[]} templateEmbeddings - Expected step embeddings with labels
 * @param {Object} filters - Search filters
 * @param {string} [filters.recordId] - Record to check (queries tool_args->>'id')
 * @param {string} [filters.modelName] - Model name (queries tool_args->>'model')
 * @param {Object} options - Query options
 * @param {number} [options.threshold=0.7] - Similarity threshold for "completed"
 * @returns {Promise<Object[]>} List of missing/low-confidence steps
 */
export async function detectGaps(pool, templateEmbeddings, filters = {}, options = {}) {
  const threshold = options.threshold || 0.7

  const conditions = []
  const baseParams = []
  let paramIdx = 1

  if (filters.recordId) {
    conditions.push(`tool_args->>'id' = $${paramIdx++}`)
    baseParams.push(filters.recordId)
  }
  if (filters.modelName) {
    conditions.push(`tool_args->>'model' = $${paramIdx}`)
    baseParams.push(filters.modelName)
  }

  const whereClause = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''

  const gaps = []

  for (const { label, embedding } of templateEmbeddings) {
    const vectorStr = `[${Array.from(embedding).join(',')}]`
    const params = [vectorStr, ...baseParams]

    const result = await pool.query(
      `SELECT MAX(1 - (embedding <=> $1)) AS max_similarity
       FROM tool_memories
       WHERE TRUE ${whereClause}`,
      params
    )

    const maxSimilarity = result.rows[0]?.max_similarity || 0

    if (maxSimilarity < threshold) {
      gaps.push({
        step: label,
        confidence: parseFloat(maxSimilarity),
        status: maxSimilarity < 0.3 ? 'missing' : 'incomplete'
      })
    }
  }

  return gaps
}

/**
 * Group tool memories into clusters by semantic similarity
 *
 * Uses a simple greedy clustering: assign each operation to the nearest
 * existing cluster or start a new one if similarity is below threshold.
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Object} filters - Search filters
 * @param {string} [filters.toolName] - Filter by tool name
 * @param {number} [filters.days=7] - Limit to last N days
 * @param {Object} options - Clustering options
 * @param {number} [options.minClusterSize=2] - Min operations per cluster
 * @param {number} [options.similarityThreshold=0.75] - Cluster membership threshold
 * @returns {Promise<Object>} Clusters and outliers
 */
export async function getClusters(pool, filters = {}, options = {}) {
  const days = filters.days || 7
  const minClusterSize = options.minClusterSize || 2
  const similarityThreshold = options.similarityThreshold || 0.75

  const conditions = [`created_at > NOW() - INTERVAL '${parseInt(days, 10)} days'`]
  const params = []
  const paramIdx = 1

  if (filters.toolName) {
    conditions.push(`tool_name = $${paramIdx}`)
    params.push(filters.toolName)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  const result = await pool.query(
    `SELECT id, tool_name, tool_args, tool_output,
            summary, created_at, embedding
     FROM tool_memories
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 500`,
    params
  )

  if (result.rows.length === 0) {
    return { clusters: [], outliers: [] }
  }

  // Greedy clustering
  const clusters = []
  const assigned = new Set()

  for (let i = 0; i < result.rows.length; i++) {
    if (assigned.has(i)) continue

    const cluster = {
      representative: result.rows[i].summary,
      toolName: result.rows[i].tool_name,
      operations: [formatOperation(result.rows[i])]
    }
    assigned.add(i)

    const embeddingI = result.rows[i].embedding

    for (let j = i + 1; j < result.rows.length; j++) {
      if (assigned.has(j)) continue

      const similarity = cosineSimilarity(embeddingI, result.rows[j].embedding)
      if (similarity >= similarityThreshold) {
        cluster.operations.push(formatOperation(result.rows[j]))
        assigned.add(j)
      }
    }

    clusters.push(cluster)
  }

  // Separate clusters from outliers
  const validClusters = clusters.filter((c) => c.operations.length >= minClusterSize)
  const outliers = clusters
    .filter((c) => c.operations.length < minClusterSize)
    .flatMap((c) => c.operations)

  return {
    clusters: validClusters.map((c) => ({
      representative: c.representative,
      toolName: c.toolName,
      count: c.operations.length,
      operations: c.operations
    })),
    outliers
  }
}

/**
 * Get tool memory statistics
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {Object} filters - Search filters
 * @param {number} [filters.days=30] - Limit to last N days
 * @param {string} [filters.toolName] - Filter by tool name
 * @returns {Promise<Object>} Statistics
 */
export async function getStats(pool, filters = {}) {
  const days = filters.days || 30
  const conditions = [`created_at > NOW() - INTERVAL '${parseInt(days, 10)} days'`]
  const params = []
  const paramIdx = 1

  if (filters.toolName) {
    conditions.push(`tool_name = $${paramIdx}`)
    params.push(filters.toolName)
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ')

  const result = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(DISTINCT tool_name) AS tools,
       COUNT(DISTINCT tool_args->>'model') AS models,
       COUNT(DISTINCT tool_args->>'id') AS records,
       COUNT(DISTINCT session_id) AS sessions,
       tool_name
     FROM tool_memories
     ${whereClause}
     GROUP BY GROUPING SETS ((), (tool_name))`,
    params
  )

  return result.rows
}

/**
 * Delete expired tool memory embeddings
 *
 * @param {pg.Pool} pool - Connection pool
 * @param {number} retentionDays - Days to retain
 * @returns {Promise<number>} Number of deleted rows
 */
export async function cleanupExpired(pool, retentionDays = 30) {
  const result = await pool.query(
    `DELETE FROM tool_memories
     WHERE created_at < NOW() - INTERVAL '${parseInt(retentionDays, 10)} days'`
  )
  return result.rowCount
}

/**
 * Format an operation row for output
 * @param {Object} row - Database row
 * @returns {Object} Formatted operation
 * @private
 */
function formatOperation(row) {
  const op = {
    id: row.id,
    toolName: row.tool_name,
    toolArgs: row.tool_args,
    summary: row.summary,
    createdAt: row.created_at
  }
  if (row.tool_output) op.toolOutput = row.tool_output
  return op
}
