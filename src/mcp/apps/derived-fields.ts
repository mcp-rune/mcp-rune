/**
 * Derived Fields -- Extract nested association data into flat record fields.
 *
 * When the API response includes expanded associations (via `?expand=...`),
 * this utility resolves derived attribute declarations into flat fields
 * on each record. For example, if a scheduling record has:
 *
 *   { title: { name: "Breaking Bad", ... }, platform: { name: "Netflix", ... } }
 *
 * and the model declares:
 *
 *   title_name: { derived: { from: 'title', field: 'name' } }
 *
 * then after resolution the record will have:
 *
 *   { title_name: "Breaking Bad", platform_name: "Netflix", ... }
 */

import type { AppModelClass } from './types.js'

/**
 * Resolve derived fields on an array of records using model attribute metadata.
 *
 * This is a no-op when the model has no derived attributes, so it is safe
 * to call unconditionally in list/search views.
 */
export function resolveDerivedFields(
  records: Record<string, unknown>[],
  ModelClass: AppModelClass
): Record<string, unknown>[] {
  const attrs = ModelClass.attributes
  if (!attrs) return records

  // Collect derived attribute specs once
  const derivedSpecs: Array<{ name: string; from: string; field: string }> = []
  for (const [name, attr] of Object.entries(attrs)) {
    if (attr.derived) {
      derivedSpecs.push({ name, from: attr.derived.from, field: attr.derived.field })
    }
  }

  if (derivedSpecs.length === 0) return records

  for (const record of records) {
    for (const { name, from, field } of derivedSpecs) {
      const association = record[from]
      record[name] =
        association != null && typeof association === 'object'
          ? ((association as Record<string, unknown>)[field] ?? null)
          : null
    }
  }

  return records
}
