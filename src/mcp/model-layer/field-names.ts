/**
 * Valid Field Names — the legal input keys a model's forms and prompts may
 * write to, derived from `static attributes` and `static associations`.
 *
 *   class Book extends BaseModel {
 *     static attributes   = { title: { type: 'string' } }
 *     static associations = {
 *       belongsTo: { author:       { target_model: 'author' } },
 *       hasMany:   { repositories: { target_model: 'repository' } }
 *     }
 *   }
 *
 *   collectValidFieldNames(Book) →
 *     { 'title',
 *       'author_id', 'author_link',                                      // from belongsTo
 *       'repositories', 'repositories_ids', 'repositories_links',        // from hasMany rel name
 *       'repository_ids', 'repository_links' }                           // from target_model (Rails singular)
 *
 * Used to reject unknown fields before they reach the API. The
 * `<target_model>_ids` form is accepted so callers can write the Rails-style
 * proper singular without us shipping a pluralization library. Reached
 * through `modelLayer.validFieldNames()` after PR2.
 */

import type { ModelClassLike } from '#src/mcp/schema/types.js'

export function collectValidFieldNames(ModelClass: ModelClassLike): Set<string> {
  const names = new Set<string>(Object.keys(ModelClass.attributes ?? {}))
  for (const assocName of Object.keys(ModelClass.associations?.belongsTo ?? {})) {
    names.add(`${assocName}_id`)
    names.add(`${assocName}_link`)
  }
  for (const [assocName, assoc] of Object.entries(ModelClass.associations?.hasMany ?? {})) {
    names.add(assocName)
    names.add(`${assocName}_ids`)
    names.add(`${assocName}_links`)
    const target = assoc.target_model
    if (target) {
      names.add(`${target}_ids`)
      names.add(`${target}_links`)
    }
  }
  return names
}
