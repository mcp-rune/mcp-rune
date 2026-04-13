import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import type { ToolResult } from '../../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { recallAnalysisMemories } from '#src/services/memory-storage.js'

interface AnalysisMemory {
  finding: string
  category?: string
  metadata?: Record<string, unknown>
  similarity?: number
}

/**
 * Recall analysis memories by ID or semantic query
 *
 * Part of the map-reduce pattern. After processing all pages,
 * the LLM recalls accumulated findings for synthesis.
 */
export class RecallAnalysisMemoriesTool extends BaseMemoryTool {
  override get name(): string {
    return 'recall_analysis_memories'
  }

  override get baseDescription(): string {
    return 'Retrieve stored analysis findings by analysis ID or semantic similarity. Use after processing all pages to synthesize findings into a report.'
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z.string().optional().describe('Analysis session ID to recall findings for'),
      query: z
        .string()
        .optional()
        .describe('Semantic query to find relevant findings across analyses'),
      category: z.string().optional().describe('Filter by finding category'),
      top_k: z.number().optional().describe('Maximum number of results (default: 50)')
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { analysis_id, query, category, top_k } = args as {
      analysis_id?: string
      query?: string
      category?: string
      top_k?: number
    }

    if (!analysis_id && !query) {
      return this.formatResponse('Please provide either an analysis_id or a semantic query.')
    }

    const filters: Record<string, unknown> = {}
    if (analysis_id) filters.analysisId = analysis_id
    if (category) filters.category = category
    if (query) filters.query = query

    const options: Record<string, unknown> = {}
    if (top_k) options.topK = top_k

    const memories = (await recallAnalysisMemories(filters, options)) as unknown as AnalysisMemory[]

    if (memories.length === 0) {
      return this.formatResponse('No analysis findings found for the given criteria.')
    }

    // Group by category if present
    const byCategory: Record<string, AnalysisMemory[]> = {}
    for (const m of memories) {
      const cat = m.category || 'uncategorized'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat]!.push(m)
    }

    const parts: string[] = [`Found ${memories.length} finding(s):\n`]

    for (const [cat, items] of Object.entries(byCategory)) {
      parts.push(`## ${cat} (${items!.length})`)
      for (const item of items!) {
        const meta = item.metadata ? ` | ${JSON.stringify(item.metadata)}` : ''
        const sim =
          item.similarity !== undefined ? ` [${(item.similarity * 100).toFixed(1)}% match]` : ''
        parts.push(`- ${item.finding}${meta}${sim}`)
      }
      parts.push('')
    }

    return this.formatResponse(parts.join('\n'))
  }
}
