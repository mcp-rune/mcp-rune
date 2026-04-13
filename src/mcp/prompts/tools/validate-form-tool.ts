/**
 * Tool for validating form fields before submission
 *
 * This is a strategy tool that doesn't require API authentication.
 * It validates fields using the appropriate strategy for the model.
 */

import { z } from 'zod'
import type { ZodTypeAny } from 'zod'
import { BaseStrategyTool } from './base-strategy-tool.js'
import type { ToolResult } from '#src/mcp/tools/base-tool.js'
import { coerceToObject } from '#src/core/helpers.js'

export class ValidateFormTool extends BaseStrategyTool {
  get name(): string {
    return 'validate_form'
  }

  get baseDescription(): string {
    return `Validate form fields before submission. Returns errors, warnings, computed values, and readiness status.

This tool is part of the form strategy system:
- **Stateless** models: Validation not supported - submit directly
- **Hybrid** models: Validates all fields at once before submission
- **Stateful** models: Supports section-by-section or full validation

Use this tool after collecting form data to:
1. Check for validation errors before submission
2. Get computed/default values that will be applied
3. Receive warnings about missing optional fields
4. Confirm the form is ready to submit`
  }

  get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: z.string().describe('Model name (e.g., "study_session", "book")'),
      fields: z.record(z.string(), z.unknown()).describe('Field values to validate'),
      section: z
        .string()
        .describe('Optional: Validate a specific section only (stateful models)')
        .optional()
    }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { model, section } = args as { model: string; section?: string }

    // Coerce fields to object - LLMs sometimes pass JSON strings instead of objects
    const fields = coerceToObject(args.fields)
    if (args.fields !== undefined && fields === null) {
      return this.formatResponse({
        valid: false,
        errors: [
          {
            field: 'fields',
            message: 'fields must be a valid object or JSON string, received: ' + typeof args.fields
          }
        ],
        ready_to_submit: false
      })
    }

    if (this.logger) {
      this.logger.info('validate_form invoked', {
        service: 'mcp-tools',
        tool: 'validate_form',
        model,
        section,
        fieldCount: Object.keys(fields || {}).length
      })
    }

    // Get the prompt class for this model
    const promptClass = this.getPromptClassByModel(model)

    if (!promptClass) {
      return this.formatUnknownModelError(model)
    }

    // Get the strategy for this prompt
    const strategy = this.getStrategy(promptClass as { strategy?: 'stateless' | 'hybrid' | 'stateful' })

    // Check if validation is supported
    const check = this.checkOperation(strategy, 'validateFields', model)
    if (!check.supported) {
      return this.formatOperationError(check.error!)
    }

    // If section is specified and strategy supports it, validate section only
    if (section && strategy.supportsOperation('validateSection')) {
      const validateSection = (strategy as unknown as { validateSection: (pc: unknown, s: string, f: Record<string, unknown>) => Record<string, unknown> }).validateSection.bind(strategy)
      const result = validateSection(promptClass, section, fields || {})

      if (this.logger) {
        this.logger.info('validate_form section result', {
          service: 'mcp-tools',
          tool: 'validate_form',
          model,
          section,
          valid: result.valid
        })
      }

      return this.formatResponse(result)
    }

    // Full validation
    const validateFields = (strategy as unknown as { validateFields: (pc: unknown, f: Record<string, unknown>) => Record<string, unknown> }).validateFields.bind(strategy)
    const result = validateFields(promptClass, fields || {})

    if (this.logger) {
      this.logger.info('validate_form result', {
        service: 'mcp-tools',
        tool: 'validate_form',
        model,
        valid: result.valid,
        ready_to_submit: result.ready_to_submit,
        errorCount: (result.errors as unknown[])?.length || 0
      })
    }

    return this.formatResponse(result)
  }
}
