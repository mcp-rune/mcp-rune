/**
 * Built-in `rule-violation` strategy.
 *
 * For each `BusinessRule` whose `scope` includes the model being summarized:
 * evaluate against every record in the page, group failures by (rule.name,
 * severity), report pass/fail counts + first 10 failed IDs. The `finding`
 * text is embedded so the LLM can recall "any rating violations?" semantically.
 *
 * Skips silently when no rule scopes this model or the page is empty.
 */

import type { SummaryInput, SummaryOutput, SummaryRule, SummaryStrategy } from './types.js'

const FAILED_LIMIT = 10

interface RuleStat {
  passed: number
  failed: number
  severity: 'error' | 'warning' | 'info'
  description?: string
  failed_ids: string[]
  example_messages: string[]
}

export const ruleViolationStrategy: SummaryStrategy = {
  name: 'rule-violation',
  description:
    'Evaluates every BusinessRule whose scope includes this model against each record and reports pass/fail counts + first failing IDs. Requires at least one BusinessRule registered for the model.',
  requires: ['domainRegistry'],
  appliesTo(input: SummaryInput): boolean {
    if (input.records.length === 0) return false
    const rules = input.domainRegistry?.rules?.getRulesForModel?.(input.model) ?? []
    return rules.length > 0
  },
  async generate(input: SummaryInput): Promise<SummaryOutput> {
    const { model, page, totalPages, records } = input
    const rules: ReadonlyArray<SummaryRule> =
      input.domainRegistry?.rules?.getRulesForModel?.(input.model) ?? []
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`

    const stats: Record<string, RuleStat> = {}
    const lines: string[] = []

    for (const rule of rules) {
      const stat: RuleStat = {
        passed: 0,
        failed: 0,
        severity: rule.severity ?? 'info',
        description: rule.description,
        failed_ids: [],
        example_messages: []
      }

      for (const record of records) {
        const result = await rule.evaluate(record)
        if (result.passed) {
          stat.passed++
        } else {
          stat.failed++
          if (stat.failed_ids.length < FAILED_LIMIT && record.id != null) {
            stat.failed_ids.push(String(record.id))
          }
          if (
            result.message &&
            stat.example_messages.length < 3 &&
            !stat.example_messages.includes(result.message)
          ) {
            stat.example_messages.push(result.message)
          }
        }
      }

      stats[rule.name] = stat

      if (stat.failed > 0) {
        const idsHint = stat.failed_ids.slice(0, 3).join(', ')
        lines.push(
          `${rule.name} (${stat.severity}): ${stat.failed}/${total} failed` +
            (idsHint ? ` (e.g. ${idsHint})` : '')
        )
      } else {
        lines.push(`${rule.name}: passed (${total}/${total})`)
      }
    }

    const finding =
      `Page ${pageLabel} of ${model} records (${total} records). ` +
      (lines.length > 0
        ? `Business rules: ${lines.join('. ')}.`
        : 'No business rules registered for this model.')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: total,
        rules: stats
      }
    }
  }
}
