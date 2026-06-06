/**
 * Built-in `distribution` strategy: per-field value distributions plus
 * numeric stats (min/max/avg/median) and ISO-date ranges. This is the
 * general-purpose default and matches the behavior `analysis_ingest`
 * shipped before the strategy mechanism existed.
 */

import type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

interface NumericStat {
  min: number
  max: number
  avg: number
  median: number
  count: number
}

interface DateRange {
  earliest: string
  latest: string
  count: number
}

export const distributionStrategy: SummaryStrategy = {
  name: 'distribution',
  description:
    'Per-field value distributions plus numeric stats (min/max/avg/median) and ISO-date ranges. The general-purpose default; pick this when unsure.',
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records, fields } = input
    const recordsArr = records as Record<string, unknown>[]

    const distributions = buildFieldDistributions(recordsArr)
    const numericStats = buildNumericStats(recordsArr)
    const dateRanges = buildDateRanges(recordsArr)

    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`
    const distLines = Object.entries(distributions)
      .map(([field, counts]) => {
        const top = Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([val, count]) => `${val}=${count}`)
          .join(', ')
        return `${field}: ${top}`
      })
      .join('. ')

    const statsLines = Object.entries(numericStats)
      .map(
        ([field, s]) =>
          `${field}: min=${s.min}, max=${s.max}, avg=${s.avg}, median=${s.median}, n=${s.count}`
      )
      .join('. ')

    const dateLines = Object.entries(dateRanges)
      .map(([field, r]) => `${field}: ${r.earliest}..${r.latest} (${r.count} values)`)
      .join('. ')

    const fieldsNote = fields ? ` Fields: ${fields.join(', ')}.` : ''
    const finding =
      `Page ${pageLabel} of ${model} records (${records.length} records).${fieldsNote}` +
      (distLines ? ` Distribution: ${distLines}.` : '') +
      (statsLines ? ` Numeric stats: ${statsLines}.` : '') +
      (dateLines ? ` Date ranges: ${dateLines}.` : '')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: records.length,
        distributions,
        numericStats,
        dateRanges
      }
    }
  }
}

/** Compute value distributions for fields with low cardinality. */
function buildFieldDistributions(
  records: Record<string, unknown>[]
): Record<string, Record<string, number>> {
  if (records.length === 0) return {}

  const distributions: Record<string, Record<string, number>> = {}

  const sample = records[0]!
  const candidateFields = Object.entries(sample)
    .filter(([key, val]) => {
      if (key === 'id') return false
      return typeof val === 'string' || typeof val === 'boolean' || val === null
    })
    .map(([key]) => key)

  for (const field of candidateFields) {
    const counts: Record<string, number> = {}
    for (const record of records) {
      const val = String(record[field] ?? 'null')
      counts[val] = (counts[val] || 0) + 1
    }
    const uniqueCount = Object.keys(counts).length
    if (uniqueCount <= records.length * 0.5 && uniqueCount <= 20) {
      distributions[field] = counts
    }
  }

  return distributions
}

/** Compute summary statistics for numeric fields. */
function buildNumericStats(records: Record<string, unknown>[]): Record<string, NumericStat> {
  if (records.length === 0) return {}

  const stats: Record<string, NumericStat> = {}

  const sample = records[0]!
  const numericFields = Object.entries(sample)
    .filter(([key, val]) => key !== 'id' && typeof val === 'number')
    .map(([key]) => key)

  for (const field of numericFields) {
    const values = records.map((r) => r[field]).filter((v): v is number => typeof v === 'number')

    if (values.length === 0) continue

    values.sort((a, b) => a - b)
    const sum = values.reduce((acc, v) => acc + v, 0)
    const mid = Math.floor(values.length / 2)
    const median = values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!

    stats[field] = {
      min: values[0]!,
      max: values[values.length - 1]!,
      avg: Math.round((sum / values.length) * 100) / 100,
      median,
      count: values.length
    }
  }

  return stats
}

/** Compute date ranges for ISO 8601 date string fields. */
function buildDateRanges(records: Record<string, unknown>[]): Record<string, DateRange> {
  if (records.length === 0) return {}

  const sample = records[0]!
  const dateFields = Object.entries(sample)
    .filter(([key, val]) => key !== 'id' && typeof val === 'string' && ISO_DATE_RE.test(val))
    .map(([key]) => key)

  const ranges: Record<string, DateRange> = {}
  for (const field of dateFields) {
    const values = records
      .map((r) => r[field])
      .filter((v): v is string => typeof v === 'string' && ISO_DATE_RE.test(v))
      .sort()

    if (values.length === 0) continue
    ranges[field] = {
      earliest: values[0]!,
      latest: values[values.length - 1]!,
      count: values.length
    }
  }

  return ranges
}
