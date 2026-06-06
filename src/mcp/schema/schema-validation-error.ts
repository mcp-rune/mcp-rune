import { formatReport } from './format-report.js'
import type { ValidationReport } from './types.js'

/**
 * Thrown when `validateRegistries` produces any `error`-level issue.
 * The `report` carries the structured issues; `message` is a pre-formatted
 * multi-line block suitable for surfacing in logs / CI output.
 */
export class SchemaValidationError extends Error {
  readonly report: ValidationReport
  constructor(report: ValidationReport) {
    super(formatReport(report))
    this.name = 'SchemaValidationError'
    this.report = report
  }
}
