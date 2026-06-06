import type { Issue, ValidationReport } from './types.js'

/**
 * Render a `ValidationReport` as a multi-line string suitable for logs or
 * CI output. Errors first, then warnings, both grouped by model.
 */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = []
  if (report.errors.length > 0) {
    lines.push(`Schema validation failed with ${report.errors.length} error(s):`)
    lines.push(...formatIssues(report.errors))
  }
  if (report.warnings.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`Schema validation produced ${report.warnings.length} warning(s):`)
    lines.push(...formatIssues(report.warnings))
  }
  return lines.join('\n')
}

function formatIssues(issues: Issue[]): string[] {
  const lines: string[] = []
  const byModel = new Map<string, Issue[]>()
  for (const i of issues) {
    const arr = byModel.get(i.model) ?? []
    arr.push(i)
    byModel.set(i.model, arr)
  }
  for (const [model, list] of byModel) {
    lines.push(`  ${model}:`)
    for (const issue of list) {
      const ref = issue.attribute ? `${issue.scope}.${issue.attribute}` : issue.scope
      lines.push(`    [${ref}] ${issue.message}`)
      if (issue.hint) lines.push(`      hint: ${issue.hint}`)
    }
  }
  return lines
}
