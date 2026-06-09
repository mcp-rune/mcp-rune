import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type { ToolResult } from '../tool-result.js'
import { BaseDomainTool } from './base-domain-tool.js'

interface RuleResult {
  rule: string
  passed: boolean
  message: string
  severity: string
  suggestion?: string
}

interface CheckResult {
  passed: boolean
  results: RuleResult[]
}

/**
 * Check business rules against proposed entity data
 *
 * Pre-flight validation of proposed data against cross-entity
 * declarative business rules. Catches constraint violations
 * before API submission.
 */
export class CheckBusinessRulesTool extends BaseDomainTool {
  override get name(): string {
    return 'check_business_rules'
  }

  override get baseDescription(): string {
    return `Validate entity data against business rules. Returns pass/fail for each applicable rule with suggestions for fixing violations.

USE THIS TOOL WHEN:
- Before creating/updating entities to catch constraint issues early
- Analyzing existing entities to check if they comply with business rules
- Troubleshooting why a right has "In conflict" status or validation failed
- Reviewing proposed changes to understand potential issues

Accepts both proposed data (pre-submission) and existing entity data (post-fetch analysis).`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: z
        .string()
        .describe('Model name to check rules for (e.g., "deal", "right", "rule", "scheduling")'),
      data: z
        .record(z.string(), z.unknown())
        .describe('Proposed entity data to validate against business rules'),
      context: z
        .record(z.string(), z.unknown())
        .describe('Additional context for rule evaluation (e.g., related parent entity data)')
        .optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.requireDomainRegistry()
    const { model, data, context } = args as {
      model: string
      data: Record<string, unknown>
      context?: Record<string, unknown>
    }

    // Check if there are rules for this model
    const ruleDescriptions = await this.domainRegistry.describeRules(model)
    if (ruleDescriptions.length === 0) {
      return this.formatResponse(`No business rules defined for model "${model}".`)
    }

    // Evaluate rules
    const result = (await this.domainRegistry.checkRules(model, data, context ?? {})) as CheckResult

    return this.formatResponse(this._formatResult(model, result))
  }

  private _formatResult(model: string, result: CheckResult): string {
    const lines = [`# Business Rule Check: ${model}`, '']
    lines.push(`**Overall:** ${result.passed ? 'PASSED' : 'FAILED'}`)
    lines.push(`**Rules evaluated:** ${result.results.length}`)
    lines.push('')

    // Group by status
    const errors = result.results.filter((r) => !r.passed && r.severity === 'error')
    const warnings = result.results.filter((r) => !r.passed && r.severity === 'warning')
    const info = result.results.filter((r) => !r.passed && r.severity === 'info')
    const passed = result.results.filter((r) => r.passed)

    if (errors.length > 0) {
      lines.push('## Errors (must fix)')
      for (const r of errors) {
        lines.push(`- **${r.rule}**: ${r.message}`)
        if (r.suggestion) lines.push(`  - Suggestion: ${r.suggestion}`)
      }
      lines.push('')
    }

    if (warnings.length > 0) {
      lines.push('## Warnings (should fix)')
      for (const r of warnings) {
        lines.push(`- **${r.rule}**: ${r.message}`)
        if (r.suggestion) lines.push(`  - Suggestion: ${r.suggestion}`)
      }
      lines.push('')
    }

    if (info.length > 0) {
      lines.push('## Info')
      for (const r of info) {
        lines.push(`- **${r.rule}**: ${r.message}`)
        if (r.suggestion) lines.push(`  - Suggestion: ${r.suggestion}`)
      }
      lines.push('')
    }

    if (passed.length > 0) {
      lines.push('## Passed')
      for (const r of passed) {
        lines.push(`- **${r.rule}**: ${r.message}`)
      }
    }

    return lines.join('\n')
  }
}
