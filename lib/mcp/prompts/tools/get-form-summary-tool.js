/**
 * Tool for generating form summaries before submission
 *
 * This is a strategy tool that doesn't require API authentication.
 * It generates human-readable and technical summaries using the appropriate strategy.
 */

import { z } from 'zod'
import { BaseStrategyTool } from './base-strategy-tool.js'
import { coerceToObject } from '#lib/core/helpers.js'

export class GetFormSummaryTool extends BaseStrategyTool {
  get name() {
    return 'get_form_summary'
  }

  get baseDescription() {
    return `Get a server-generated summary of form fields before submission.

Returns both human-readable and technical (API-ready) summaries.
Useful for presenting a confirmation to the user before final submission.

Supported by: Hybrid and Stateful strategy models
Not supported by: Stateless strategy models`
  }

  get inputSchema() {
    return {
      model: z.string().describe('Model name'),
      fields: z.record(z.string(), z.unknown()).describe('Field values to summarize')
    }
  }

  async execute(args) {
    const { model } = args

    // Coerce fields to object - LLMs sometimes pass JSON strings instead of objects
    const fields = coerceToObject(args.fields)
    if (args.fields !== undefined && fields === null) {
      return this.formatResponse({
        error: 'fields must be a valid object or JSON string, received: ' + typeof args.fields
      })
    }

    if (this.logger) {
      this.logger.info('get_form_summary invoked', {
        service: 'mcp-tools',
        tool: 'get_form_summary',
        model,
        fieldCount: Object.keys(fields || {}).length
      })
    }

    // Get the prompt class for this model
    const promptClass = this.getPromptClassByModel(model)

    if (!promptClass) {
      return this.formatUnknownModelError(model)
    }

    // Get the strategy for this prompt
    const strategy = this.getStrategy(promptClass)

    // Check if summary generation is supported
    const check = this.checkOperation(strategy, 'generateSummary', model)
    if (!check.supported) {
      return this.formatOperationError(check.error)
    }

    // Generate summary
    const result = strategy.generateSummary(promptClass, fields || {}, { model })

    if (this.logger) {
      this.logger.info('get_form_summary result', {
        service: 'mcp-tools',
        tool: 'get_form_summary',
        model,
        hasHumanSummary: !!result.human,
        hasTechnicalSummary: !!result.technical
      })
    }

    return this.formatResponse(result)
  }
}
