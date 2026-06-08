import { embed, embedBatch } from './embeddings.js'
import { adaptToolOutput } from './tool-output-adapters.js'
import type {
  ClusterFilters,
  ClusterOptions,
  ClusterResult,
  GapFilters,
  GapOptions,
  GapResult,
  OperationFilters,
  QueryOptions
} from './vector-storage-definitions-tool-memories.js'
import { getAdapter } from './vector-storage-state.js'

export interface StoreOperationParams {
  toolName: string
  toolArgs?: Record<string, unknown>
  toolOutput?: Record<string, unknown>
  sessionId?: string
  userId?: string
}

/**
 * Store a tool operation embedding
 *
 * Converts the operation to natural language, generates an embedding,
 * and stores both in the vector database. Fire-and-forget from callers.
 */
export async function storeOperation(operation: StoreOperationParams): Promise<string | null> {
  const adapter = getAdapter()
  if (!adapter) return null

  const toolOutput = adaptToolOutput(operation.toolName, operation.toolOutput, operation.toolArgs)
  const summary = operationToText(operation, toolOutput)
  const embedding = await embed(summary)

  return adapter.toolMemories.storeOperation(embedding, {
    toolName: operation.toolName,
    toolArgs: operation.toolArgs,
    toolOutput,
    userId: operation.userId,
    sessionId: operation.sessionId,
    summary
  })
}

/** Find operations similar to a query */
export async function findSimilarOperations(
  query: string,
  filters: OperationFilters = {},
  options: QueryOptions = {}
): Promise<Record<string, unknown>[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  const embedding = await embed(query)
  return adapter.toolMemories.findSimilar(embedding, filters, options)
}

/** Detect gaps in operations for a record */
export async function detectOperationGaps(
  expectedSteps: string[],
  filters: GapFilters = {},
  options: GapOptions = {}
): Promise<GapResult[]> {
  const adapter = getAdapter()
  if (!adapter) return []

  const embeddings = await embedBatch(expectedSteps)
  const templateEmbeddings = expectedSteps.map((label, i) => ({
    label,
    embedding: embeddings[i]!
  }))

  return adapter.toolMemories.detectGaps(templateEmbeddings, filters, options)
}

/** Get operation clusters grouped by semantic similarity */
export async function getOperationClusters(
  filters: ClusterFilters = {},
  options: ClusterOptions = {}
): Promise<ClusterResult> {
  const adapter = getAdapter()
  if (!adapter) return { clusters: [], outliers: [] }
  return adapter.toolMemories.getClusters(filters, options)
}

/** Get operation statistics */
export async function getOperationStats(
  filters: Record<string, unknown> = {}
): Promise<Record<string, unknown>[]> {
  const adapter = getAdapter()
  if (!adapter) return []
  return adapter.toolMemories.getStats(filters)
}

function operationToText(
  op: StoreOperationParams,
  toolOutput: Record<string, unknown> | null
): string {
  const { toolName, toolArgs = {} } = op

  switch (toolName) {
    case 'create_model': {
      const model = (toolArgs.model as string) || 'unknown'
      const attrs = (toolArgs.attributes as Record<string, unknown>) || {}
      const name = (attrs.name as string) || (attrs.title as string) || ''
      const nameStr = name ? ` '${name}'` : ''
      const fields = Object.entries(attrs)
        .map(([k, v]) => `${k}: ${formatValue(v)}`)
        .join(', ')
      const idSuffix = toolOutput?.id ? ` -> id: ${toolOutput.id}` : ''
      return `create_model ${model}${nameStr}. Fields: ${fields}${idSuffix}`
    }
    case 'update_model': {
      const model = (toolArgs.model as string) || 'unknown'
      const id = (toolArgs.id as string) || ''
      const attrs = (toolArgs.attributes as Record<string, unknown>) || {}
      const changed = Object.keys(attrs).join(', ')
      return `update_model ${model} '${id}'. Changed: ${changed}`
    }
    case 'delete_model': {
      const model = (toolArgs.model as string) || 'unknown'
      const id = (toolArgs.id as string) || ''
      return `delete_model ${model} '${id}'`
    }
    case 'bulk_action_models': {
      const model = (toolArgs.model as string) || 'unknown'
      const action = (toolArgs.action as string) || 'unknown'
      const count = (toolArgs.record_count as number) || 0
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

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '...' : value
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 100)
  return String(value)
}
