/**
 * Built-in `entity-extraction` strategy: tallies association references
 * (`*_id` fields other than the record's own `id`) and surfaces the most
 * frequent entities per field. Useful for relationship mapping and
 * spotting hot referenced records.
 *
 * `appliesTo` skips this strategy when records have no association fields.
 */

import type { SummaryInput, SummaryOutput, SummaryStrategy } from './types.js'

const TOP_N = 5

interface EntityField {
  total_refs: number
  unique_refs: number
  top: Array<{ id: string; count: number }>
}

export const entityExtractionStrategy: SummaryStrategy = {
  name: 'entity-extraction',
  description:
    'Tallies *_id association references and surfaces the top entities per field. Applies only when records have association id fields.',
  appliesTo(input: SummaryInput): boolean {
    return findEntityFields(input.records as Record<string, unknown>[]).length > 0
  },
  generate(input: SummaryInput): SummaryOutput {
    const { model, page, totalPages, records } = input
    const recs = records as Record<string, unknown>[]
    const total = records.length
    const pageLabel = totalPages ? `${page}/${totalPages}` : `${page}`

    const fields = findEntityFields(recs)
    const byField: Record<string, EntityField> = {}
    const lines: string[] = []

    for (const field of fields) {
      const counts: Record<string, number> = {}
      for (const r of recs) {
        const v = r[field]
        if (v === null || v === undefined) continue
        const key = String(v)
        counts[key] = (counts[key] || 0) + 1
      }
      const totalRefs = Object.values(counts).reduce((a, b) => a + b, 0)
      const top = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, TOP_N)
        .map(([id, count]) => ({ id, count }))

      byField[field] = {
        total_refs: totalRefs,
        unique_refs: Object.keys(counts).length,
        top
      }

      const topStr = top.map((t) => `${t.id}=${t.count}`).join(', ')
      lines.push(
        `${field}: ${totalRefs} refs across ${Object.keys(counts).length} unique` +
          (topStr ? ` (top: ${topStr})` : '')
      )
    }

    const finding =
      `Page ${pageLabel} of ${model} records (${total} records). ` +
      (lines.length > 0 ? `Entities: ${lines.join('. ')}.` : 'No association fields detected.')

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

function findEntityFields(records: Record<string, unknown>[]): string[] {
  if (records.length === 0) return []
  const keys = new Set<string>()
  for (const r of records) for (const k of Object.keys(r)) keys.add(k)
  return [...keys].filter((k) => k !== 'id' && k.endsWith('_id'))
}
