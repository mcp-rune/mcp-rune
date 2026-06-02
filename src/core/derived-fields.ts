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
 *
 * Lives in `core` because it is consumed across feature boundaries: by MCP
 * apps (`list-model-app`, `search-model-app`) and by the `search` ApiExtension's
 * `search_records` tool. Decoupled from any specific model-shape import.
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
