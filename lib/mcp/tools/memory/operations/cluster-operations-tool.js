import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import { getOperationClusters } from '#lib/services/memory-storage.js'

/**
 * Group recent operations by semantic similarity
 *
 * Identifies clusters of related operations and outliers.
 */
export class ClusterOperationsTool extends BaseMemoryTool {
  get name() {
    return 'cluster_operations'
  }

  get baseDescription() {
    return 'Group recent CRUD operations by semantic similarity. Identifies patterns and outlier operations.'
  }

  get inputSchema() {
    return {
      days: z.number().describe('Limit to last N days (default: 7)').optional(),
      tool_name: z
        .string()
        .describe('Filter by tool name (e.g., create_model, update_model, delete_model)')
        .optional(),
      min_cluster_size: z
        .number()
        .describe('Minimum operations per cluster (default: 2)')
        .optional()
    }
  }

  async execute(args) {
    const { days, tool_name, min_cluster_size } = args || {}

    const filters = {}
    if (days) filters.days = days
    if (tool_name) filters.toolName = tool_name

    const options = {}
    if (min_cluster_size) options.minClusterSize = min_cluster_size

    const { clusters, outliers } = await getOperationClusters(filters, options)

    if (clusters.length === 0 && outliers.length === 0) {
      return this.formatResponse('No operations found for the given time period.')
    }

    const parts = []

    if (clusters.length > 0) {
      parts.push(`Found ${clusters.length} cluster(s):\n`)
      for (const [i, cluster] of clusters.entries()) {
        parts.push(`Cluster ${i + 1}: "${cluster.representative}" (${cluster.count} operations)`)
        for (const op of cluster.operations) {
          const outputStr = op.toolOutput ? ` | Output: ${JSON.stringify(op.toolOutput)}` : ''
          parts.push(
            `  - [${op.toolName}] ${op.summary} (${new Date(op.createdAt).toISOString()})${outputStr}`
          )
        }
        parts.push('')
      }
    }

    if (outliers.length > 0) {
      parts.push(`Outliers (${outliers.length}):`)
      for (const op of outliers) {
        parts.push(`  - [${op.toolName}] ${op.summary}`)
      }
    }

    return this.formatResponse(parts.join('\n'))
  }
}
