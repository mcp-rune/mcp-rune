/**
 * Built-in `anomaly` strategy: numeric z-score outliers and rare-value flags
 * on enum-like fields. Surfaces records that don't fit the page's central
 * tendency. Useful for hunting data-quality problems or interesting edges.
 */

import type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const Z_THRESHOLD = 2
const RARE_VALUE_RATE = 0.05
const MIN_RECORDS = 4
const MAX_REPORTED = 5

interface NumericOutlier {
  field: string
  id?: string
  value: number
  z: number
}

interface RareValue {
  field: string
  value: string
  count: number
  rate: number
}

export const anomalyStrategy: SummaryStrategy = {
  name: 'anomaly',
  description:
    'Numeric z-score outliers (|z|>2) and rare-value flags on enum-like fields. Pick this to hunt for data-quality issues or interesting edges.',
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const recs = records as Record<string, unknown>[]
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`

    if (total < MIN_RECORDS) {
      return {
        finding:
          `Page ${pageLabel} of ${model} records (${total} records). ` +
          `Insufficient data for anomaly detection (need at least ${MIN_RECORDS}).`,
        metadata: {
          page,
          model,
          record_count: total,
          insufficient_data: true,
          z_threshold: Z_THRESHOLD,
          rare_value_rate: RARE_VALUE_RATE
        }
      }
    }

    const outliers = findNumericOutliers(recs).slice(0, MAX_REPORTED)
    const rares = findRareValues(recs).slice(0, MAX_REPORTED)

    const outlierLine = outliers
      .map((o) => `${o.field}=${o.value}${o.id ? ` (id=${o.id})` : ''} z=${o.z.toFixed(2)}`)
      .join('; ')
    const rareLine = rares
      .map((r) => `${r.field}="${r.value}" ${r.count}/${total} (${pct(r.rate)})`)
      .join('; ')

    const parts: string[] = [`Page ${pageLabel} of ${model} records (${total} records).`]
    if (outliers.length > 0) parts.push(`Numeric outliers (|z|>${Z_THRESHOLD}): ${outlierLine}.`)
    if (rares.length > 0) parts.push(`Rare values (<${pct(RARE_VALUE_RATE)}): ${rareLine}.`)
    if (outliers.length === 0 && rares.length === 0) {
      parts.push('No anomalies detected.')
    }

    return {
      finding: parts.join(' '),
      metadata: {
        page,
        model,
        record_count: total,
        z_threshold: Z_THRESHOLD,
        rare_value_rate: RARE_VALUE_RATE,
        numeric_outliers: outliers,
        rare_values: rares
      }
    }
  }
}

function findNumericOutliers(records: Record<string, unknown>[]): NumericOutlier[] {
  if (records.length === 0) return []
  const sample = records[0]!
  const numericFields = Object.entries(sample)
    .filter(([key, val]) => key !== 'id' && typeof val === 'number')
    .map(([key]) => key)

  const outliers: NumericOutlier[] = []
  for (const field of numericFields) {
    const values = records
      .map((r, idx) => ({ idx, val: r[field] }))
      .filter((x): x is { idx: number; val: number } => typeof x.val === 'number')
    if (values.length < 2) continue

    const mean = values.reduce((acc, x) => acc + x.val, 0) / values.length
    const variance = values.reduce((acc, x) => acc + (x.val - mean) ** 2, 0) / values.length
    const stddev = Math.sqrt(variance)
    if (stddev === 0) continue

    for (const { idx, val } of values) {
      const z = (val - mean) / stddev
      if (Math.abs(z) > Z_THRESHOLD) {
        const id = records[idx]?.id
        outliers.push({
          field,
          id: typeof id === 'string' ? id : undefined,
          value: val,
          z: Math.round(z * 100) / 100
        })
      }
    }
  }

  outliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  return outliers
}

function findRareValues(records: Record<string, unknown>[]): RareValue[] {
  if (records.length === 0) return []
  const sample = records[0]!
  const enumFields = Object.entries(sample)
    .filter(([key, val]) => {
      if (key === 'id') return false
      return typeof val === 'string' || typeof val === 'boolean'
    })
    .map(([key]) => key)

  const rares: RareValue[] = []
  for (const field of enumFields) {
    const counts: Record<string, number> = {}
    for (const r of records) {
      const v = r[field]
      if (v === null || v === undefined) continue
      const key = String(v)
      counts[key] = (counts[key] || 0) + 1
    }
    const unique = Object.keys(counts).length
    if (unique <= 1 || unique > 20) continue

    for (const [value, count] of Object.entries(counts)) {
      const rate = count / records.length
      if (rate < RARE_VALUE_RATE) {
        rares.push({ field, value, count, rate: Math.round(rate * 1000) / 1000 })
      }
    }
  }

  rares.sort((a, b) => a.rate - b.rate)
  return rares
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
