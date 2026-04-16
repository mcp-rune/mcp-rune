/**
 * DisplayAdapter -- Controls how model records appear in list, search, and
 * detail views.
 *
 * Adapters decouple *display* visibility from *prompt* visibility. A field
 * can be `prompt_visible: false` (hidden in creation forms) yet still appear
 * in tables and detail cards -- e.g. read-only status enums and derived fields.
 *
 * ## Extension Points
 *
 * | Method               | Purpose                                        |
 * |----------------------|------------------------------------------------|
 * | `isColumnVisible`    | Should this attribute appear as a list column?  |
 * | `isDetailVisible`    | Should this attribute appear in a detail card?  |
 * | `getDefaultColumns`  | Curated column subset when none are requested   |
 * | `getEnumHints`       | Icon + CSS class for semantic enum badges       |
 * | `buildColumn`        | Build a single column definition object         |
 */

import { humanize } from './helpers.js'
import type {
  AppAttributeDefinition,
  AppModelClass,
  ColumnDefinition,
  DetailFieldDefinition
} from './types.js'

export class DisplayAdapter {
  /**
   * Check whether an attribute should be visible as a list/search column.
   *
   * Default rules:
   * - Exclude `id` field
   * - Exclude `format: 'base64'` (binary data)
   * - Exclude `type: 'text'` except `description` (long text)
   * - Exclude `list_visible: false` (explicit opt-out)
   * - Include everything else -- including `prompt_visible: false` fields
   */
  isColumnVisible(name: string, attr: AppAttributeDefinition): boolean {
    if (name === 'id') return false
    if (attr.format === 'base64') return false
    if (attr.type === 'text' && name !== 'description') return false
    if (attr.list_visible === false) return false
    return true
  }

  /**
   * Check whether an attribute should be visible in a detail/record card.
   *
   * Default rules mirror `isColumnVisible` plus excluding `base64`.
   * Override for model-specific detail visibility.
   */
  isDetailVisible(_name: string, attr: AppAttributeDefinition): boolean {
    if (attr.format === 'base64') return false
    if (attr.list_visible === false) return false
    return true
  }

  /** Get the default column names when no explicit selection is provided. */
  getDefaultColumns(ModelClass: AppModelClass): string[] | null {
    return ModelClass.defaultColumns || null
  }

  /**
   * Get display hints for an enum field value.
   *
   * Return an object with optional `icon` (Unicode character) and
   * `className` (CSS class for semantic coloring) for the given value.
   * Return `null` for default badge rendering (no icon, no color).
   */
  getEnumHints(_fieldName: string, _value: string): { icon?: string; className?: string } | null {
    return null
  }

  /** Build a column definition from an attribute. */
  buildColumn(name: string, attr: AppAttributeDefinition): ColumnDefinition {
    return {
      name,
      label: attr.label || humanize(name),
      type: attr.type || 'string',
      sortable: !attr.derived,
      ...(attr.enumValues && { enumValues: attr.enumValues }),
      ...(attr.derived && { derived: attr.derived })
    }
  }

  /**
   * Infer which columns to show in list/search views.
   *
   * Iterates model attributes, filters via `isColumnVisible`, builds
   * column definitions, and attaches enum hints when available.
   */
  inferColumns(ModelClass: AppModelClass): ColumnDefinition[] {
    const attrs = ModelClass.attributes || {}
    const columns: ColumnDefinition[] = []

    for (const [name, attr] of Object.entries(attrs)) {
      if (!this.isColumnVisible(name, attr)) continue
      const col = this.buildColumn(name, attr)

      // Attach enum hints if the adapter provides them
      if (col.enumValues) {
        const hints: Record<string, { icon?: string; className?: string }> = {}
        let hasHints = false
        for (const val of col.enumValues) {
          const hint = this.getEnumHints(name, val)
          if (hint) {
            hints[val] = hint
            hasHints = true
          }
        }
        if (hasHints) col.enumHints = hints
      }

      columns.push(col)
    }

    return columns
  }

  /** Infer which fields to show in detail/record views. */
  inferDetailFields(ModelClass: AppModelClass): DetailFieldDefinition[] {
    const attrs = ModelClass.attributes || {}
    const fields: DetailFieldDefinition[] = []

    for (const [name, attr] of Object.entries(attrs)) {
      if (!this.isDetailVisible(name, attr)) continue
      fields.push(this._buildDetailField(name, attr, ModelClass))
    }

    return fields
  }

  /** Build a detail field definition from an attribute. */
  protected _buildDetailField(
    name: string,
    attr: AppAttributeDefinition,
    ModelClass: AppModelClass
  ): DetailFieldDefinition {
    const field: DetailFieldDefinition = {
      name,
      label: attr.label || humanize(name),
      type: attr.type || 'string',
      ...(attr.format && { format: attr.format }),
      ...(attr.enumValues && { enumValues: attr.enumValues }),
      ...(attr.validation && { validation: attr.validation })
    }

    // Mark association fields for server-side resolution
    if (name.endsWith('_id') && ModelClass?.associations?.belongsTo) {
      const assocName = name.replace(/_id$/, '')
      const assoc = ModelClass.associations.belongsTo[assocName]
      if (assoc) {
        field.association = {
          endpoint: this._pluralize(assoc.target_model),
          labelField: 'name'
        }
      }
    }

    return field
  }

  /** Basic English pluralization. */
  private _pluralize(word: string): string {
    if (word.endsWith('s')) return word
    if (word.endsWith('y')) return word.slice(0, -1) + 'ies'
    return word + 's'
  }
}
