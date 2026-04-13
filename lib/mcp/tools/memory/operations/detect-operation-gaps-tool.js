import { z } from 'zod'
import { BaseMemoryTool } from '../base-memory-tool.js'
import { detectOperationGaps } from '#lib/services/memory-storage.js'

/**
 * Detect missing workflow steps for a record
 *
 * Compares actual operations on a record against expected
 * workflow steps to identify gaps.
 */
export class DetectOperationGapsTool extends BaseMemoryTool {
  get name() {
    return 'detect_operation_gaps'
  }

  get baseDescription() {
    return 'Compare operations on a record against expected workflow steps. Identifies missing or incomplete steps.'
  }

  get inputSchema() {
    return {
      record_id: z.string().describe('Record ID to check operations for'),
      model_name: z.string().describe('Model name (e.g., deal, brand, rule)'),
      expected_steps: z
        .array(z.string())
        .describe(
          'List of expected workflow step descriptions (e.g., ["Create deal with basic info", "Set platforms", "Add restrictions", "Activate deal"])'
        )
    }
  }

  async execute(args) {
    const { record_id, model_name, expected_steps } = args

    if (!expected_steps || expected_steps.length === 0) {
      return this.formatResponse(
        'No expected steps provided. Please specify the workflow steps to check against.'
      )
    }

    const gaps = await detectOperationGaps(expected_steps, {
      recordId: record_id,
      modelName: model_name
    })

    if (gaps.length === 0) {
      return this.formatResponse(
        `All ${expected_steps.length} expected steps appear to be completed for ${model_name} ${record_id}.`
      )
    }

    const formatted = gaps
      .map((g, i) => {
        const confidence = (g.confidence * 100).toFixed(1)
        const icon = g.status === 'missing' ? 'MISSING' : 'INCOMPLETE'
        return `${i + 1}. [${icon}] ${g.step} (${confidence}% confidence)`
      })
      .join('\n')

    return this.formatResponse(
      `Found ${gaps.length} gap(s) out of ${expected_steps.length} expected steps for ${model_name} ${record_id}:\n\n${formatted}`
    )
  }
}
