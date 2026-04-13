import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import { clearAnalysisMemories } from '#lib/services/memory-storage.js'

/**
 * Clear analysis memories after synthesis is complete
 *
 * Part of the map-reduce pattern. After the LLM has synthesized
 * findings into a report, it cleans up the analysis memories.
 */
export class ClearAnalysisMemoriesTool extends BaseMemoryTool {
  get name() {
    return 'clear_analysis_memories'
  }

  get baseDescription() {
    return 'Clear stored analysis findings after synthesis is complete. Use to clean up after a qualitative analysis session.'
  }

  get inputSchema() {
    return {
      analysis_id: z.string().describe('Analysis session ID to clear findings for')
    }
  }

  async execute(args) {
    const { analysis_id } = args

    const count = await clearAnalysisMemories(analysis_id)

    return this.formatResponse(`Cleared ${count} finding(s) for analysis "${analysis_id}".`)
  }
}
