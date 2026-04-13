/**
 * Memory Storage Service - Vendor-Agnostic Public API
 *
 * Captures tool operations as semantic embeddings for retrospective analysis:
 * "what did I miss?", "how does this compare?", "what patterns emerge?"
 *
 * Mirrors the facade pattern of tracing.js and error-tracking.js.
 * To switch vendors, update the import below.
 *
 * When not configured (no env vars), all functions become no-ops.
 *
 * @example
 * import { initMemoryStorage, storeOperation } from '#lib/services/memory-storage.js'
 *
 * // Initialize once at startup
 * initMemoryStorage({ serviceName: 'mcp-server-mod', retentionDays: 30 })
 *
 * // Store after tool operations (fire-and-forget)
 * storeOperation({ toolName: 'create_model', toolArgs: { model: 'deal', attributes: { ... } } })
 */

// Vendor implementation - change this import to switch vendors
import * as vendor from './vendor/pgvector/index.js'
import * as operations from './vendor/pgvector/tool-memories.js'
import * as analysisMemories from './vendor/pgvector/analysis-memories.js'
import { embed, embedBatch } from './embeddings.js'
import { adaptToolOutput } from './tool-output-adapters.js'

/**
 * Initialize memory storage service
 *
 * Call once at server startup. No-op if env vars not set.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.serviceName - Name of the MCP server
 * @param {string} options.version - Server version
 * @param {number} [options.retentionDays=30] - Days to retain embeddings
 * @returns {boolean} True if initialized successfully
 */
export function initMemoryStorage(options = {}) {
  return vendor.initialize(options)
}

/**
 * Check if memory storage is configured and enabled
 * @returns {boolean}
 */
export function isMemoryStorageEnabled() {
  return vendor.isConfigured()
}

/**
 * Store a tool operation embedding
 *
 * Converts the operation to natural language, generates an embedding,
 * and stores both in the vector database. Fire-and-forget from callers.
 *
 * @param {Object} operation - Operation details
 * @param {string} operation.toolName - Tool name (e.g., 'create_model', 'update_model')
 * @param {Object} [operation.toolArgs] - Tool arguments
 * @param {Object} [operation.toolOutput] - Raw tool response (passed through adapter)
 * @param {string} [operation.sessionId] - MCP session ID
 * @param {string} [operation.userId] - User ID
 * @returns {Promise<string|null>} Stored record ID, or null if disabled
 */
export async function storeOperation(operation) {
  if (!vendor.isConfigured()) return null

  const pool = vendor.getPool()
  if (!pool) return null

  const toolOutput = adaptToolOutput(operation.toolName, operation.toolOutput, operation.toolArgs)
  const summary = operationToText(operation, toolOutput)
  const embedding = await embed(summary)

  return operations.storeOperation(pool, embedding, {
    toolName: operation.toolName,
    toolArgs: operation.toolArgs,
    toolOutput,
    userId: operation.userId,
    sessionId: operation.sessionId,
    summary
  })
}

/**
 * Find operations similar to a query
 *
 * @param {string} query - Natural language query
 * @param {Object} [filters] - Search filters
 * @param {string} [filters.toolName] - Filter by tool name
 * @param {number} [filters.days] - Limit to last N days
 * @param {string} [filters.sessionId] - Filter by session
 * @param {Object} [options] - Query options
 * @param {number} [options.topK=10] - Max results
 * @param {number} [options.threshold=0.5] - Min similarity
 * @returns {Promise<Object[]>} Ranked similar operations
 */
export async function findSimilarOperations(query, filters = {}, options = {}) {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  const embedding = await embed(query)
  return operations.findSimilar(pool, embedding, filters, options)
}

/**
 * Detect gaps in operations for a record
 *
 * @param {string[]} expectedSteps - Expected workflow step descriptions
 * @param {Object} filters - Search filters
 * @param {string} filters.recordId - Record to check
 * @param {string} filters.modelName - Model name
 * @param {Object} [options] - Query options
 * @param {number} [options.threshold=0.7] - Similarity threshold
 * @returns {Promise<Object[]>} Missing/incomplete steps
 */
export async function detectOperationGaps(expectedSteps, filters = {}, options = {}) {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  const embeddings = await embedBatch(expectedSteps)
  const templateEmbeddings = expectedSteps.map((label, i) => ({
    label,
    embedding: embeddings[i]
  }))

  return operations.detectGaps(pool, templateEmbeddings, filters, options)
}

/**
 * Get operation clusters grouped by semantic similarity
 *
 * @param {Object} [filters] - Search filters
 * @param {number} [filters.days=7] - Limit to last N days
 * @param {string} [filters.toolName] - Filter by tool name
 * @param {Object} [options] - Clustering options
 * @param {number} [options.minClusterSize=2] - Min cluster size
 * @returns {Promise<Object>} Clusters and outliers
 */
export async function getOperationClusters(filters = {}, options = {}) {
  if (!vendor.isConfigured()) return { clusters: [], outliers: [] }

  const pool = vendor.getPool()
  if (!pool) return { clusters: [], outliers: [] }

  return operations.getClusters(pool, filters, options)
}

/**
 * Get operation statistics
 *
 * @param {Object} [filters] - Search filters
 * @returns {Promise<Object>} Statistics
 */
export async function getOperationStats(filters = {}) {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  return operations.getStats(pool, filters)
}

/**
 * Store an analysis memory finding
 *
 * @param {Object} params - Finding details
 * @param {string} params.analysisId - Analysis session identifier
 * @param {string} params.finding - The finding text
 * @param {string} [params.category] - Finding category
 * @param {Object} [params.metadata] - Additional structured metadata
 * @param {boolean} [params.persistent=false] - Whether finding survives expiration
 * @returns {Promise<string|null>} Stored record ID, or null if disabled
 */
export async function storeAnalysisMemory(params) {
  if (!vendor.isConfigured()) return null

  const pool = vendor.getPool()
  if (!pool) return null

  const embedding = await embed(params.finding)
  return analysisMemories.storeMemory(pool, embedding, params)
}

/**
 * Recall analysis memories by filters and/or semantic query
 *
 * @param {Object} [filters] - Recall filters
 * @param {string} [filters.analysisId] - Filter by analysis ID
 * @param {string} [filters.category] - Filter by category
 * @param {string} [filters.query] - Semantic search query
 * @param {Object} [options] - Query options
 * @param {number} [options.topK=50] - Max results
 * @param {number} [options.threshold=0.5] - Min similarity
 * @returns {Promise<Object[]>} Recalled memories
 */
export async function recallAnalysisMemories(filters = {}, options = {}) {
  if (!vendor.isConfigured()) return []

  const pool = vendor.getPool()
  if (!pool) return []

  const queryFilters = { ...filters }
  if (filters.query) {
    queryFilters.embedding = await embed(filters.query)
    delete queryFilters.query
  }

  return analysisMemories.recallMemories(pool, queryFilters, options)
}

/**
 * Clear analysis memories by analysis ID
 *
 * @param {string} analysisId - Analysis ID to clear
 * @returns {Promise<number>} Number of deleted rows
 */
export async function clearAnalysisMemories(analysisId) {
  if (!vendor.isConfigured()) return 0

  const pool = vendor.getPool()
  if (!pool) return 0

  return analysisMemories.clearMemories(pool, analysisId)
}

/**
 * Flush pending memory storage writes
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function flushMemoryStorage(timeout = 5000) {
  return vendor.flush(timeout)
}

/**
 * Close memory storage service
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function closeMemoryStorage(timeout = 5000) {
  return vendor.close(timeout)
}

/**
 * Convert a tool operation to natural language text for embedding
 *
 * @param {Object} op - Operation details
 * @param {string} op.toolName - Tool name
 * @param {Object} [op.toolArgs] - Tool arguments
 * @param {Object} [toolOutput] - Adapted tool output (from adapter)
 * @returns {string} Human-readable summary
 * @private
 */
function operationToText(op, toolOutput) {
  const { toolName, toolArgs = {} } = op

  switch (toolName) {
    case 'create_model': {
      const model = toolArgs.model || 'unknown'
      const attrs = toolArgs.attributes || {}
      const name = attrs.name || attrs.title || ''
      const nameStr = name ? ` '${name}'` : ''
      const fields = Object.entries(attrs)
        .map(([k, v]) => `${k}: ${formatValue(v)}`)
        .join(', ')
      const idSuffix = toolOutput?.id ? ` -> id: ${toolOutput.id}` : ''
      return `create_model ${model}${nameStr}. Fields: ${fields}${idSuffix}`
    }
    case 'update_model': {
      const model = toolArgs.model || 'unknown'
      const id = toolArgs.id || ''
      const attrs = toolArgs.attributes || {}
      const changed = Object.keys(attrs).join(', ')
      return `update_model ${model} '${id}'. Changed: ${changed}`
    }
    case 'delete_model': {
      const model = toolArgs.model || 'unknown'
      const id = toolArgs.id || ''
      return `delete_model ${model} '${id}'`
    }
    case 'bulk_action_models': {
      const model = toolArgs.model || 'unknown'
      const action = toolArgs.action || 'unknown'
      const count = toolArgs.record_count || 0
      return `bulk_action_models ${action} ${count} ${model} records`
    }
    default: {
      const argsStr =
        Object.keys(toolArgs).length > 0
          ? ` with args: ${JSON.stringify(toolArgs).slice(0, 200)}`
          : ''
      return `${toolName}${argsStr}`
    }
  }
}

/**
 * Format a value for summary text
 * @param {*} value
 * @returns {string}
 * @private
 */
function formatValue(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '...' : value
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 100)
  return String(value)
}
