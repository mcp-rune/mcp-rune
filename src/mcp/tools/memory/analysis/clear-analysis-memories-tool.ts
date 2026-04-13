import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import type { ToolResult } from '../../base-tool.js'
import type { ZodTypeAny } from 'zod'
import { clearAnalysisMemories } from '#src/services/memory-storage.js'

/**
 * Clear analysis memories after synthesis is complete
 *
 * Part of the map-reduce pattern. After the LLM has synthesized
 * findings into a report, it cleans up the analysis memories.
 */
export class ClearAnalysisMemoriesTool extends BaseMemoryTool {
  override get name(): string {
    return 'clear_analysis_memories'
  }

  override get baseDescription(): string {
    return 'Clear stored analysis findings after synthesis is complete. Use to clean up after a qualitative analysis session.'
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z.string().describe('Analysis session ID to clear findings for')
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { analysis_id } = args as { analysis_id: string }

    const count = await clearAnalysisMemories(analysis_id)

    return this.formatResponse(`Cleared ${count} finding(s) for analysis "${analysis_id}".`)
  }
}
