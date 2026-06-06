/**
 * Shared helpers for the new_model_app and edit_model_app factories.
 *
 * Both apps render the same form schema, fetch association options from the
 * API at form-open time, and merge prefill values onto defaults. Only the
 * mode-specific concerns (mode gate + parent-context banner for new; record
 * fetch for edit) stay in each factory.
 */

import { normalizeListWithConvention } from '#src/mcp/data-layer/model-service/model-service.js'
import * as logger from '#src/runtime/logger.js'

import { errorMeta } from './helpers.js'
import type { AppModelClass, DataLayer, FormFieldDefinition } from './types.js'

/**
 * Fetch association options from the API for fields that declare associations.
 * Mutates the fields array in place, adding `options` to association fields.
 */
export async function resolveAssociationOptions(
  fields: FormFieldDefinition[],
  dataLayer: DataLayer,
  defaults: Record<string, unknown> = {}
): Promise<void> {
  const associationFields = fields.filter((f) => f.association)
  if (associationFields.length === 0) return

  const fetches = associationFields.map(async (field) => {
    try {
      let endpoint = field.association!.endpoint

      // Handle nested associations (e.g., categories under themes)
      if (field.association!.nested) {
        const { parentModel, childEndpoint } = field.association!.nested
        const parentValue = defaults[`${parentModel}_id`]
        if (!parentValue) {
          field.options = []
          return
        }
        const parentModelEndpoint = field.association!.endpoint
        endpoint = `${parentModelEndpoint}/${String(parentValue)}/${childEndpoint}`
      }

      const data = await dataLayer.dispatch('GET', endpoint)
      const { records } = normalizeListWithConvention(data, field.association!.convention, {
        page: 1,
        perPage: 200
      })

      const valueField = field.association!.valueField || 'id'
      field.options = records.map((record) => ({
        value: String(record[valueField] || record.id),
        label: String(record[field.association!.labelField] || record.name || `ID: ${record.id}`),
        ...(record.color ? { color: String(record.color) } : {})
      }))
    } catch (err) {
      logger.warn('Failed to resolve association options', {
        service: 'mcp-app',
        field: field.name,
        endpoint: field.association!.endpoint,
        ...errorMeta(err)
      })
      // If API call fails, leave as empty select -- form still renders
      field.options = []
    }
  })

  await Promise.all(fetches)
}

/**
 * Build default values from model attributes for fields in the form.
 * Used when no PromptClass is available.
 */
export function buildDefaultsFromModel(
  ModelClass: AppModelClass,
  FormClass: { fields?: string[]; [key: string]: unknown }
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  const fieldNames = FormClass?.fields || []
  for (const name of fieldNames) {
    const attr = ModelClass.attributes[name]
    if (attr?.default !== undefined) {
      defaults[name] = attr.default
    }
  }
  return defaults
}

/** Filter out null/undefined/empty-string values from an object */
export function filterEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && val !== undefined && val !== '') {
      result[key] = val
    }
  }
  return result
}
