import type { ModelClassLike } from './types.js'

/**
 * Collect every legal form/prompt field name for a model:
 *   - all attribute names
 *   - for belongsTo associations: `<name>_id` and `<name>_link`
 *   - for hasMany associations: the rel name itself, `<rel>_ids` / `<rel>_links`,
 *     and `<target_model>_ids` / `<target_model>_links` (Rails-style proper
 *     singular, e.g. `repository_ids` for hasMany.repositories with
 *     target_model: 'repository'). We accept the target_model form without
 *     shipping a pluralization library.
 */
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
