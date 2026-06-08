import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { findSimilarOperations } from '#src/runtime/vector-storage.js'

import type { ToolResult } from '../tool-result.js'
import { BaseOperationsTool } from './base-operations-tool.js'

interface SimilarOperation {
  similarity: number
  summary: string
  tool_name: string
  tool_output?: Record<string, unknown>
  created_at: string
}

/**
 * Find past CRUD operations similar to a query
 *
 * Embeds the query text and runs similarity search against
 * stored operation embeddings.
 */
export class FindSimilarOperationsTool extends BaseOperationsTool {
  override get name(): string {
    return 'find_similar_operations'
  }

  override get baseDescription(): string {
    return 'Search past CRUD operations by semantic similarity. Use to find related work, compare approaches, or recall what was done.'
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      query: z
        .string()
        .describe(
          'Natural language query describing what you\'re looking for (e.g., "deals created for BBC content")'
        ),
      tool_name: z
        .string()
        .describe('Filter by tool name (e.g., create_model, update_model, delete_model)')
        .optional(),
      days: z.number().describe('Limit to last N days (default: 30)').optional(),
      top_k: z.number().describe('Maximum number of results (default: 10)').optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { query, tool_name, days, top_k } = args as {
      query: string
      tool_name?: string
      days?: number
      top_k?: number
    }

    const filters: Record<string, unknown> = {}
    if (tool_name) filters.toolName = tool_name
    if (days) filters.days = days

    const options: Record<string, unknown> = {}
    if (top_k) options.topK = top_k

    const results = (await findSimilarOperations(
      query,
      filters,
      options
    )) as unknown as SimilarOperation[]

    if (results.length === 0) {
      return this.formatResponse('No similar operations found for the given query.')
    }

    const formatted = results
      .map((r, i) => {
        const similarity = (r.similarity * 100).toFixed(1)
        const outputLine = r.tool_output ? `   Output: ${JSON.stringify(r.tool_output)}` : null
        return [
          `${i + 1}. [${similarity}% match] ${r.summary}`,
          `   Tool: ${r.tool_name}`,
          outputLine,
          `   Date: ${new Date(r.created_at).toISOString()}`
        ]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n\n')

    return this.formatResponse(`Found ${results.length} similar operations:\n\n${formatted}`)
  }
}
