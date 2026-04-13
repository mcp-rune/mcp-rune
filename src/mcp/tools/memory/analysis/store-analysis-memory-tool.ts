import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import type { ToolResult } from '../../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { storeAnalysisMemory } from '#src/services/memory-storage.js'

const MAX_BATCH_SIZE = 25

interface Finding {
  finding: string
  category?: string
  metadata?: Record<string, unknown>
}

/**
 * Store analysis findings with semantic embeddings
 *
 * Part of the map-reduce pattern for large-scale qualitative analysis.
 * The LLM processes records page by page, storing findings as it goes.
 * Supports batching up to 25 findings per call to reduce tool-call overhead.
 */
export class StoreAnalysisMemoryTool extends BaseMemoryTool {
  override get name(): string {
    return 'store_analysis_memory'
  }

  override get baseDescription(): string {
    return `Store findings from qualitative analysis (max ${MAX_BATCH_SIZE} per call). Use during page-by-page processing of large result sets to accumulate insights for later synthesis.`
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
