/**
 * Built-in `temporal` strategy: time-based patterns over ISO-date string
 * fields. Buckets records by day/week/month (picked from the overall span),
 * detects empty buckets that fall inside the span, and reports recency vs
 * the strategy's notion of "now" (the latest seen timestamp).
 *
 * `appliesTo` skips this strategy when records have no ISO-date field.
 */

import type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/
const DAY_MS = 24 * 60 * 60 * 1000

type Bucket = 'day' | 'week' | 'month'

interface FieldTemporal {
  bucket: Bucket
  earliest: string
  latest: string
  span_days: number
  per_bucket: Record<string, number>
  empty_buckets: number
}

export const temporalStrategy: SummaryStrategy = {
  name: 'temporal',
  description:
    'Day/week/month bucketed counts plus gap detection and recency over ISO-date fields. Applies only when records carry timestamps.',
  appliesTo(input: SummaryInput): boolean {
    return findDateFields(input.records as Record<string, unknown>[]).length > 0
  },
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const recs = records as Record<string, unknown>[]
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`

    const dateFields = findDateFields(recs)
    const byField: Record<string, FieldTemporal> = {}
    const lines: string[] = []

    for (const field of dateFields) {
      const t = analyzeField(recs, field)
      if (!t) continue
      byField[field] = t
      lines.push(
        `${field}: ${t.span_days}d span, ${t.bucket}-bucketed (${Object.keys(t.per_bucket).length} buckets, ${t.empty_buckets} empty); ` +
          `${t.earliest} → ${t.latest}`
      )
    }

    const finding =
      `Page ${pageLabel} of ${model} records (${total} records). ` +
      (lines.length > 0 ? `Temporal: ${lines.join('. ')}.` : 'No analyzable date fields.')

    return {
      finding,
      metadata: {
        page,
        model,
        record_count: total,
        fields: byField
      }
    }
  }
}

function findDateFields(records: Record<string, unknown>[]): string[] {
  if (records.length === 0) return []
  const sample = records[0]!
  return Object.entries(sample)
    .filter(([key, val]) => key !== 'id' && typeof val === 'string' && ISO_DATE_RE.test(val))
    .map(([key]) => key)
}

function analyzeField(records: Record<string, unknown>[], field: string): FieldTemporal | null {
  const dates = records
    .map((r) => r[field])
    .filter((v): v is string => typeof v === 'string' && ISO_DATE_RE.test(v))
    .map((s) => s.slice(0, 10))
    .sort()

  if (dates.length === 0) return null

  const earliest = dates[0]!
  const latest = dates[dates.length - 1]!
  const spanDays = Math.max(1, Math.round(diffDays(earliest, latest)))
  const bucket: Bucket = spanDays > 90 ? 'month' : spanDays > 14 ? 'week' : 'day'

  const perBucket: Record<string, number> = {}
  for (const d of dates) {
    const key = bucketKey(d, bucket)
    perBucket[key] = (perBucket[key] || 0) + 1
  }

  const expected = expectedBuckets(earliest, latest, bucket)
  const empty = expected.filter((k) => !(k in perBucket)).length

  return {
    bucket,
    earliest,
    latest,
    span_days: spanDays,
    per_bucket: perBucket,
    empty_buckets: empty
  }
}

function bucketKey(isoDate: string, bucket: Bucket): string {
  if (bucket === 'month') return isoDate.slice(0, 7)
  if (bucket === 'day') return isoDate
  const week = isoWeekStart(isoDate)
  return week
}

function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (day - 1))
  return d.toISOString().slice(0, 10)
}

function diffDays(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`)
  const b = Date.parse(`${bIso}T00:00:00Z`)
  return (b - a) / DAY_MS
}

function expectedBuckets(earliest: string, latest: string, bucket: Bucket): string[] {
  const out: string[] = []
  let cur = startOfBucket(earliest, bucket)
  const end = startOfBucket(latest, bucket)
  while (cur <= end) {
    out.push(cur)
    cur = advanceBucket(cur, bucket)
  }
  return out
}

function startOfBucket(isoDate: string, bucket: Bucket): string {
  return bucketKey(isoDate, bucket)
}

function advanceBucket(key: string, bucket: Bucket): string {
  if (bucket === 'month') {
    const [y, m] = key.split('-').map(Number) as [number, number]
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    return `${nextY}-${String(nextM).padStart(2, '0')}`
  }
  const step = bucket === 'day' ? 1 : 7
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + step)
  return d.toISOString().slice(0, 10)
}
