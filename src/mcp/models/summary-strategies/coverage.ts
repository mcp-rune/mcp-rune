/**
 * Built-in `coverage` strategy: per-field null/empty rate across the page.
 * Useful for data-quality audits — surfaces fields that are systematically
 * missing or sparsely populated.
 */

import type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

interface FieldCoverage {
  present: number
  missing: number
  missing_rate: number
}

const SPARSE_THRESHOLD = 0.5

export const coverageStrategy: SummaryStrategy = {
  name: 'coverage',
  description:
    'Per-field null/empty rate across the page; flags fields with sparse or systematic missingness. Pick this for data-quality audits.',
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const total = records.length
    const coverage = computeCoverage(records as Record<string, unknown>[])

    const sparse = Object.entries(coverage)
      .filter(([, c]) => c.missing_rate >= SPARSE_THRESHOLD)
      .sort(([, a], [, b]) => b.missing_rate - a.missing_rate)

    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`
    const sparseLines = sparse
      .map(([field, c]) => `${field}: ${pct(c.missing_rate)} missing (${c.missing}/${total})`)
      .join('; ')

    const fieldCount = Object.keys(coverage).length
    const finding =
      `Page ${pageLabel} of ${model} records (${total} records). ` +
      `Coverage across ${fieldCount} field(s).` +
      (sparseLines
        ? ` Sparse fields (>=${pct(SPARSE_THRESHOLD)} missing): ${sparseLines}.`
        : ' No sparse fields detected.')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: total,
        coverage,
        sparse_threshold: SPARSE_THRESHOLD,
        sparse_fields: sparse.map(([field]) => field)
      }
    }
  }
}

function computeCoverage(records: Record<string, unknown>[]): Record<string, FieldCoverage> {
  if (records.length === 0) return {}

  const keys = new Set<string>()
  for (const r of records) for (const k of Object.keys(r)) keys.add(k)

  const out: Record<string, FieldCoverage> = {}
  for (const key of keys) {
    let present = 0
    for (const r of records) {
      const v = r[key]
      if (v !== null && v !== undefined && v !== '') present++
    }
    const missing = records.length - present
    out[key] = {
      present,
      missing,
      missing_rate: Math.round((missing / records.length) * 1000) / 1000
    }
  }
  return out
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
