/**
 * AssociationConfig — declarative association metadata for a model.
 *
 * Lives in the model domain; data-layer conventions read it to derive API
 * fields (e.g. `{rel}_id`, `{singular}_ids`).
 */

export interface BelongsToAssociation {
  target_model: string
  required?: boolean
  description?: string
  endpoint?: string
  autocomplete?: boolean
}

export interface HasManyAssociation {
  target_model: string
  required?: boolean
  many: true
  description?: string
  autocomplete?: boolean
}

export interface AssociationConfig {
  belongsTo?: Record<string, BelongsToAssociation>
  hasMany?: Record<string, HasManyAssociation>
}
