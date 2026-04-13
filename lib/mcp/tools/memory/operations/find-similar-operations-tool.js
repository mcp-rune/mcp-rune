import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import { findSimilarOperations } from '#lib/services/memory-storage.js'

/**
 * Find past CRUD operations similar to a query
 *
 * Embeds the query text and runs similarity search against
 * stored operation embeddings.
 */
export class FindSimilarOperationsTool extends BaseMemoryTool {
  get name() {
    return 'find_similar_operations'
  }

  get baseDescription() {
    return 'Search past CRUD operations by semantic similarity. Use to find related work, compare approaches, or recall what was done.'
  }

  get inputSchema() {
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

  async execute(args) {
    const { query, tool_name, days, top_k } = args

    const filters = {}
    if (tool_name) filters.toolName = tool_name
    if (days) filters.days = days

    const options = {}
    if (top_k) options.topK = top_k

    const results = await findSimilarOperations(query, filters, options)

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
