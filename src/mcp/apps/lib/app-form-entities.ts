/**
 * app-form entity types
 *
 * Single source of truth for all public-facing interfaces in the app-form subsystem.
 * Import from here when you need to reference these shapes outside of their originating module.
 *
 * --- Stage 1: Model declares what associations EXIST (ModelClass.associations) ---
 *
 *   ModelClass.associations.belongsTo = {
 *     title: { target_model: 'title', required: true  },  // required comes from here
 *     asset: { target_model: 'asset', required: false },
 *   }
 *   ModelClass.associations.hasMany = {
 *     tags:  { target_model: 'tag',   required: false },  // many: true comes from here
 *   }
 *
 * --- Stage 2: Form author declares which associations it NEEDS (AppFormAssociationEntry) ---
 *
 *   class BookForm extends BaseAppForm {
 *     static associations = [
 *       'title',                                    // shorthand — name = 'title'
 *
 *       { name: 'asset',                            // lookup key → belongsTo['asset']
 *         dependsOn: 'title',                       // picker UI: only show assets that
 *                                                   //   belong to the already-selected title
 *         picker: 'autocomplete' },                 // search-as-you-type (large catalog)
 *
 *       { name: 'nav_ref',                          // NOT in belongsTo — a "navigation" assoc:
 *                                                   //   a context selector that scopes the whole
 *                                                   //   creation flow but isn't stored as an
 *                                                   //   attribute on the model itself
 *         targetModel: 'ref',                       // REQUIRED here: no belongsTo entry to fall
 *                                                   //   back on, so author must name the model
 *         required: true,                           // REQUIRED here: same reason — no model
 *                                                   //   metadata to derive 'required' from
 *         picker: 'list' },                         // browse all (small set)
 *     ]
 *   }
 *
 *   Shared with model:     association name — the lookup key into belongsTo / hasMany.
 *   Form-only:             dependsOn, picker — UI hints the model knows nothing about.
 *   Author-supplied only for navigation assocs: targetModel, required (overrides model default).
 *
 * --- Stage 3: resolveFormAssociations() merges both → AppFormAssociation ---
 *
 *   'title'   → belongsTo['title']   → required: true,  targetModel: 'title'
 *   'asset'   → belongsTo['asset']   → required: false, targetModel: 'asset'
 *   'tags'    → hasMany['tags']      → required: false, targetModel: 'tag',  many: true
 *   'nav_ref' → not in belongsTo     → uses inline required + targetModel from form entry
 *
 *   AppFormAssociation = { association: 'title', required: true, targetModel: 'title' }
 *   //                    required and targetModel are NOW ALWAYS PRESENT after this step.
 *   //                    AppFormAssociationEntry left them optional because the form is a static
 *   //                    class property (no ModelClass available at definition time).
 *   //                    Producing a new type also keeps "what the author declared" separate
 *   //                    from "what the runtime discovered about the model."
 *
 * --- Stage 4: unresolved AppFormAssociation → AppFormAssociationInstruction ---
 *
 *   'title' not in prefill → unresolved → buildAssociationInstructions() adds message:
 *
 *   { association: 'title', required: true, targetModel: 'title',
 *     message: 'Select a title' }
 *   //         ↑ computed from required + many + dependsOn; the LLM's action item
 *
 *   new_model_app returns { status: 'associations_needed', associations: [...instructions] }
 *   LLM reads message + targetModel + picker → calls picker tool → re-calls new_model_app
 *   with prefill: { title_id: 123 }.  When hasUnresolvedRequired === false, form opens.
 *
 *   Why a separate type from AppFormAssociation?  AppFormAssociation appears in BOTH the
 *   resolved and unresolved buckets of AppFormAssociationResolution.  'message' only belongs
 *   to unresolved associations — adding it to AppFormAssociation would imply all associations
 *   (including already-resolved ones) carry a message.
 */

/** Form-layout grouping for related fields. Purely presentational. */
export interface AppFormFieldsetConfig {
  title?: string
  description?: string
  required?: boolean
  fields?: string[]
}

/**
 * Valid picker UIs for association selectors.
 *   autocomplete — search-as-you-type, suited for large catalogs
 *   list         — browse all scoped records, suited for small sets
 */
export type AppFormPicker = 'autocomplete' | 'list'

/**
 * Form-author declaration: which associations must be resolved before this form can open.
 * Lives on FormClass.associations (static). This is the INPUT to the resolution pipeline —
 * model metadata (required, targetModel, many) is not yet merged in.
 *
 * 'name' is the lookup key into ModelClass.associations.belongsTo[name] or .hasMany[name].
 * 'targetModel' and 'required' are optional because they default from the model's own
 * association config.  Only navigation associations (not in belongsTo) must set them explicitly.
 * See module header for full examples.
 */
export interface AppFormAssociationEntry {
  name: string
  dependsOn?: string
  targetModel?: string
  required?: boolean
  picker?: AppFormPicker
}

/** Child records to create automatically after the main record is saved. */
export interface AppFormPostCreateConfig {
  model: string
  parentPath: string
  attributeMap: Record<string, string>
}

/**
 * A single association after resolution: normalized from AppFormAssociationEntry and merged
 * with the model's belongsTo / hasMany metadata.
 *
 * 'required' and 'targetModel' are ALWAYS present here (derived from the model unless
 * overridden by the form entry — see module header, Stage 3).  'many' is true for hasMany.
 *
 * Produced by resolveFormAssociations(); both the resolved and unresolved buckets of
 * AppFormAssociationResolution contain this type.
 */
export interface AppFormAssociation {
  association: string
  required: boolean
  targetModel: string
  many?: boolean
  dependsOn?: string
  picker?: AppFormPicker
}

/**
 * An LLM-actionable request to resolve a missing association.
 *
 * Same shape as AppFormAssociation with one addition: 'message', a computed human-readable
 * string the LLM acts on (e.g. "Select a title", "Optionally select one or more tags").
 * Produced by buildAssociationInstructions() from the unresolved bucket only — resolved
 * associations never get a message (nothing to do).  See module header, Stage 4.
 */
export interface AppFormAssociationInstruction {
  association: string
  targetModel: string
  required: boolean
  many?: boolean
  message: string // human-readable prompt for the LLM to act on
  picker?: AppFormPicker
  dependsOn?: string
}

/**
 * The full output of resolveFormAssociations().
 *
 * Splits the form's declared associations into two buckets based on the current prefill:
 *   resolved   — already provided; form may use these as defaults
 *   unresolved — still missing; hasUnresolvedRequired gates the form open
 *
 * hasUnresolvedRequired is true when at least one required association is in the unresolved
 * bucket, which blocks the form from opening until the caller satisfies it.
 */
export interface AppFormAssociationResolution {
  resolved: AppFormAssociation[]
  unresolved: AppFormAssociation[]
  hasUnresolvedRequired: boolean
}
