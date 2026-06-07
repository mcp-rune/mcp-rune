import type { AppFormClass } from './app-form-entities.js'
import type { AppModelClass } from './app-shared-entities.js'

/**
 * Build a default form class from a model's attributes when the deployer
 * has not supplied one. Every attribute whose definition does not set
 * `prompt_visible: false` becomes a field, in declaration order. Models
 * that would produce an empty field list (zero renderable attributes)
 * should be dropped by the caller — `validateAppForm` raises on empty
 * `fields` at boot.
 */
export function synthesizeDefaultFormClass(ModelClass: AppModelClass): AppFormClass {
  const fields: string[] = []
  for (const [name, attr] of Object.entries(ModelClass.attributes)) {
    if (attr?.prompt_visible === false) continue
    fields.push(name)
  }
  return { fields }
}
