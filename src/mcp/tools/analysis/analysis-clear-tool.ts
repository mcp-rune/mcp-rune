import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import {
  clearAnalysisMemories,
  clearIngestedEdges,
  clearIngestedRecords
} from '#src/runtime/vector-storage.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseAnalysisTool } from './base-analysis-tool.js'

/**
 * Clean up all data from an analysis session.
 *
 * Part of the analysis_* tool family:
 *   analysis_ingest → analysis_store → analysis_query → analysis_clear
 *
 * Cascade-clears both analysis_memories AND ingested_records for the
 * given analysis_id.
 */
export class AnalysisClearTool extends BaseAnalysisTool {
  override get name(): string {
    return 'analysis_clear'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  }

  override get baseDescription(): string {
    return `Clean up all data from an analysis session — ingested records, edges, and stored findings. Call this after synthesizing your final report to free storage.

This clears:
- All ingested records stored by analysis_ingest
- All relationship edges discovered during multi-hop ingest
- All qualitative findings stored by analysis_store
- All auto-generated page summaries

When to use: After you've completed your analysis and presented the final synthesis to the user.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z.string().describe('Analysis session ID to clear all data for')
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { analysis_id } = args as { analysis_id: string }

    const [findingsCount, ingestedCount, edgesCount] = await Promise.all([
      clearAnalysisMemories(analysis_id),
      clearIngestedRecords(analysis_id),
      clearIngestedEdges(analysis_id)
    ])

    return this.formatResponse(
      `Cleared ${ingestedCount} ingested record(s), ${edgesCount} edge(s), and ${findingsCount} finding(s) for analysis "${analysis_id}".`
    )
  }
}
