import { z } from 'zod'
import { BaseAnalysisTool } from './base-analysis-tool.js'
import type { ToolResult, ToolAnnotations } from '../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { storeAnalysisMemory } from '#src/services/vector-storage.js'

const MAX_BATCH_SIZE = 25

interface Finding {
  finding: string
  category?: string
  metadata?: Record<string, unknown>
}

/**
 * Store LLM-generated qualitative findings with semantic embeddings.
 *
 * Part of the analysis_* tool family:
 *   analysis_ingest → analysis_store → analysis_query → analysis_clear
 *
 * Use this to record patterns, anomalies, or conclusions discovered while
 * querying ingested data via analysis_query. Findings are embedded
 * semantically and can be recalled later via analysis_query in semantic mode.
 */
export class AnalysisStoreTool extends BaseAnalysisTool {
  override get name(): string {
    return 'analysis_store'
  }

  override get annotations(): ToolAnnotations {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }

  override get baseDescription(): string {
    return `Store your own qualitative findings and insights during analysis (max ${MAX_BATCH_SIZE} per call). These are LLM-generated observations — not raw data (raw data is stored automatically by analysis_ingest).

Use this to record patterns, anomalies, or conclusions you discover while querying ingested data via analysis_query. Findings are embedded semantically and can be recalled later via analysis_query in semantic mode.

When to use: After reasoning about query results and forming an insight worth remembering for the final synthesis.
When NOT to use: Don't store raw record data here — analysis_ingest handles that automatically.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z
        .string()
        .describe('Unique identifier for this analysis session (e.g., "title-audit-2024-03")'),
      findings: z
        .array(
          z.object({
            finding: z.string().describe('The finding or insight to store'),
            category: z
              .string()
              .optional()
              .describe(
                'Category for grouping findings (e.g., "missing_metadata", "naming_inconsistency", "duplicate")'
              ),
            metadata: z
              .record(z.string(), z.unknown())
              .optional()
              .describe(
                'Additional structured data about the finding (e.g., record IDs, field values)'
              )
          })
        )
        .min(1)
        .max(MAX_BATCH_SIZE)
        .describe(`Findings to store (1-${MAX_BATCH_SIZE}). One entry per logical group.`),
      persistent: z
        .boolean()
        .optional()
        .describe(
          'If true, findings persist across conversations. Default: false (expires after 1 hour)'
        )
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { analysis_id, findings, persistent } = args as {
      analysis_id: string
      findings: Finding[]
      persistent?: boolean
    }

    const ids = await Promise.all(
      findings.map((f) =>
        storeAnalysisMemory({
          analysisId: analysis_id,
          finding: f.finding,
          category: f.category,
          metadata: f.metadata,
          persistent
        })
      )
    )

    const durability = persistent ? 'persistent' : 'ephemeral (expires in 1 hour)'
    const categories = [...new Set(findings.map((f) => f.category).filter(Boolean))]
    const categoryLine = categories.length > 0 ? `\nCategories: ${categories.join(', ')}` : ''

    return this.formatResponse(
      `Stored ${ids.length} analysis finding(s) (${durability}).` +
        `\nAnalysis: ${analysis_id}${categoryLine}` +
        `\nIDs: ${ids.join(', ')}`,
      { meta: { context: { consumed: true } } }
    )
  }
}
