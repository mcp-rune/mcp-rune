/**
 * Edge extraction and textification for analysis_ingest.
 *
 * Pure functions — no I/O. Consumed by both the ingest tool (extracts edges
 * to persist in ingested_edges) and the embedding pipeline (builds the text
 * that gets fed to the embedding model).
 */

import type { AssociationConfig } from '#src/mcp/data-layer/api-conventions/base-convention.js'

export interface Edge {
  src_model: string
  src_id: string
  dst_model: string
  dst_id: string
  edge_type: string
}

export type HopFollow = 'declared' | 'declared+fk' | 'none'

export interface ExtractOptions {
  /** Controls which `_id`-shaped fields become edges. */
  hopFollow?: HopFollow
}

/**
 * Extract edges from a single record using its model's declared associations.
 *
 * `belongsTo` → one edge per non-null `<rel>_id`.
 * `hasMany` → one edge per element of `<singular>_ids`, when present.
 * `declared+fk` mode → also emits `edge_type: 'fk:<field>'` for undeclared
 *   `*_id` fields (excluding the record's own `id`).
 */
export function extractEdgesFromRecord(
  record: Record<string, unknown>,
  associations: AssociationConfig | undefined,
  sourceModel: string,
  options: ExtractOptions = {}
): Edge[] {
  const hopFollow = options.hopFollow ?? 'declared'
  if (hopFollow === 'none') return []

  const srcId = record.id != null ? String(record.id) : null
  if (!srcId) return []

  const edges: Edge[] = []
  const declaredFields = new Set<string>()

  const belongsTo = associations?.belongsTo
  if (belongsTo) {
    for (const [rel, assoc] of Object.entries(belongsTo)) {
      const fkField = `${rel}_id`
      declaredFields.add(fkField)
      const dstIdRaw = record[fkField]
      if (dstIdRaw == null) continue
      edges.push({
        src_model: sourceModel,
        src_id: srcId,
        dst_model: assoc.target_model,
        dst_id: String(dstIdRaw),
        edge_type: `belongsTo:${rel}`
      })
    }
  }

  const hasMany = associations?.hasMany
  if (hasMany) {
    for (const [rel, assoc] of Object.entries(hasMany)) {
      const singular = rel.endsWith('s') ? rel.slice(0, -1) : rel
      const idsField = `${singular}_ids`
      declaredFields.add(idsField)
      const raw = record[idsField]
      if (!Array.isArray(raw)) continue
      for (const dstIdRaw of raw) {
        if (dstIdRaw == null) continue
        edges.push({
          src_model: sourceModel,
          src_id: srcId,
          dst_model: assoc.target_model,
          dst_id: String(dstIdRaw),
          edge_type: `hasMany:${rel}`
        })
      }
    }
  }

  if (hopFollow === 'declared+fk') {
    for (const [field, value] of Object.entries(record)) {
      if (value == null) continue
      if (field === 'id') continue
      if (!field.endsWith('_id')) continue
      if (declaredFields.has(field)) continue
      const dstModel = inferModelFromIdField(field)
      edges.push({
        src_model: sourceModel,
        src_id: srcId,
        dst_model: dstModel,
        dst_id: String(value),
        edge_type: `fk:${field}`
      })
    }
  }

  return edges
}

function inferModelFromIdField(field: string): string {
  return field.slice(0, -3)
}

export interface EmbeddingTextOptions {
  /** When provided, restrict to this field list. Otherwise all string-valued attributes. */
  fields?: ReadonlyArray<string>
  /** Cap on the rendered string. Default 512. */
  maxLength?: number
}

/**
 * Deterministic textification of a record for embedding.
 *
 * Concatenates `${field}: ${value}` for each string-valued attribute, sorted
 * by field name. Excludes `id` and any `*_id` (not semantically meaningful as
 * text). Truncates at `maxLength` with " …" suffix.
 */
export function buildEmbeddingText(
  record: Record<string, unknown>,
  options: EmbeddingTextOptions = {}
): string {
  const maxLength = options.maxLength ?? 512
  const allowed = options.fields ? new Set(options.fields) : null

  const parts: string[] = []
  const keys = Object.keys(record).sort()
  for (const key of keys) {
    if (key === 'id') continue
    if (key.endsWith('_id')) continue
    if (allowed && !allowed.has(key)) continue
    const value = record[key]
    if (value == null) continue
    if (typeof value === 'string') {
      if (value.length === 0) continue
      parts.push(`${key}: ${value}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}: ${String(value)}`)
    }
  }

  const joined = parts.join('. ')
  if (joined.length <= maxLength) return joined
  return joined.slice(0, maxLength - 2) + ' …'
}
