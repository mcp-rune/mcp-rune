import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { getOperationClusters } from '#src/services/vector-storage.js'

import type { ToolResult } from '../base-tool.js'
import { BaseOperationsTool } from './base-operations-tool.js'

interface ClusterOperation {
  toolName: string
  summary: string
  createdAt: string
  toolOutput?: Record<string, unknown>
}

interface Cluster {
  representative: string
  count: number
  operations: ClusterOperation[]
}

/**
 * Group recent operations by semantic similarity
 *
 * Identifies clusters of related operations and outliers.
 */
export class ClusterOperationsTool extends BaseOperationsTool {
  override get name(): string {
    return 'cluster_operations'
  }

  override get baseDescription(): string {
    return 'Group recent CRUD operations by semantic similarity. Identifies patterns and outlier operations.'
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
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

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { days, tool_name, min_cluster_size } = (args ?? {}) as {
      days?: number
      tool_name?: string
      min_cluster_size?: number
    }

    const filters: Record<string, unknown> = {}
    if (days) filters.days = days
    if (tool_name) filters.toolName = tool_name

    const options: Record<string, unknown> = {}
    if (min_cluster_size) options.minClusterSize = min_cluster_size

    const { clusters, outliers } = (await getOperationClusters(filters, options)) as unknown as {
      clusters: Cluster[]
      outliers: ClusterOperation[]
    }

    if (clusters.length === 0 && outliers.length === 0) {
      return this.formatResponse('No operations found for the given time period.')
    }

    const parts: string[] = []

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
