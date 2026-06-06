/**
 * Derived Fields — the `derived: { from, field }` you write on a model's
 * `static attributes` to flatten nested association data into top-level fields.
 *
 *   class Scheduling extends BaseModel {
 *     static attributes = {
 *       title:      { type: 'belongsTo' },                                           // API returns { name: 'Breaking Bad', … }
 *       title_name: { type: 'string', derived: { from: 'title', field: 'name' } }    // ← derived declaration
 *     }
 *   }
 *
 * Each attribute with `derived: { from, field }` says: "after the API
 * expands `from`, copy `from.field` into a flat top-level field on the
 * record." `resolveDerivedFields(records, ModelClass)` performs that copy
 * across an array of records — turning `{ title: { name: 'X' } }` into
 * `{ title: { name: 'X' }, title_name: 'X' }`.
 *
 * Consumed by apps (`find-model-app`, `view-selection-app`) and by the
 * `search` ApiExtension's `search_records` tool. Reached through
 * `modelLayer.resolveDerivedFields(records)` after PR2.
 */

/**
 * Minimal shape this function needs to walk. Any model class with attributes
 * whose entries optionally carry a `derived: { from, field }` is acceptable —
 * including `AppModelClass`, `ModelConfig`, and `BaseModel` subclasses.
 */
export interface ModelWithDerivedAttrs {
  attributes?: Record<string, { derived?: { from: string; field: string } }>
}

/**
 * Resolve derived fields on an array of records using model attribute metadata.
 *
 * This is a no-op when the model has no derived attributes, so it is safe
 * to call unconditionally in list/search views.
 */
export function resolveDerivedFields(
  records: Record<string, unknown>[],
  ModelClass: ModelWithDerivedAttrs
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
