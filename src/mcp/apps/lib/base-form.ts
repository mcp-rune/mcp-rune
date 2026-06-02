/**
 * BaseForm -- base class for interactive form definitions.
 *
 * Each Form class declares which fields an interactive form renders,
 * optional fieldset layout, associations (resolved via pickers before
 * the form opens), and post-create steps (child records created after).
 *
 * Presence of a Form class in the FormRegistry = "Interactive Form"
 * option is available for that model.
 *
 * Interactive creation has two phases:
 *   1. Association phase -- resolve associations via pickers (required ones block the form)
 *   2. Scalar phase -- render the form with only the `fields` attributes
 */

export interface FieldsetConfig {
  title?: string
  description?: string
  required?: boolean
  fields?: string[]
}

export interface FormAssociationEntry {
  name: string
  dependsOn?: string
  targetModel?: string
  required?: boolean
  picker?: string
}

export interface PostCreateConfig {
  model: string
  parentPath: string
  attributeMap: Record<string, string>
}

export class BaseForm {
  /** Fields the form renders (attribute names from the model) */
  static fields: string[] = []

  /** Optional fieldset layout -- null = single default fieldset */
  static fieldsets: Record<string, FieldsetConfig> | null = null

  /**
   * Association names to resolve before the form opens.
   *
   * Array of association names (must exist in ModelClass.associations.belongsTo).
   * The `required` flag comes from the model's association config.
   * Required associations block the form; optional ones are offered but skippable.
   *
   * Example: ['linear_channel', 'title', 'asset']
   */
  static associations: Array<string | FormAssociationEntry> | null = null

  /** Child records created after the main record is submitted */
  static postCreate: PostCreateConfig[] | null = null
}
