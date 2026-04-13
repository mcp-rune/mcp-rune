/**
 * Detail Schema Generator
 *
 * Generates detail view schemas from model attributes and prompt configuration.
 * Used by the record detail MCP App to dynamically render record cards.
 *
 * Always returns a flat field list. When a PromptClass is provided, its
 * fieldGroups determine field ordering (grouped fields first, remaining after).
 *
 * The schema is a pure data structure — no API calls, no side effects.
 * Association fields are marked with an `association` property so the
 * app's handleToolCall can resolve IDs to labels from the API.
 */

import { humanize, pluralize } from './helpers.js'

/**
 * Build a single field definition from a model attribute.
 * @param {string} name - Field name
 * @param {Object} attr - Attribute config from model
 * @param {Object} [ModelClass] - Model class for association lookup
 * @returns {Object} Field definition
 */
function buildField(name, attr, ModelClass) {
  const field = {
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
      field.association = { endpoint: pluralize(assoc.target_model), labelField: 'name' }
    }
  }

  return field
}

/**
 * Check whether a field should be excluded from the detail view.
 * @param {Object} attr - Attribute config from model
 * @returns {boolean} True if the field should be excluded
 */
function isExcluded(attr) {
  return attr.prompt_visible === false || attr.format === 'base64'
}

/**
 * Infer which fields to show in a detail view from model attributes.
 * Includes all visible fields with their display metadata.
 *
 * @param {Object} ModelClass - Model class with static attributes
 * @returns {Object[]} Array of field definitions
 */
function inferFields(ModelClass) {
  const attrs = ModelClass.attributes || {}
  const fields = []

  for (const [name, attr] of Object.entries(attrs)) {
    if (isExcluded(attr)) continue
    fields.push(buildField(name, attr, ModelClass))
  }

  return fields
}

/**
 * Build ordered fields using PromptClass fieldGroups for ordering.
 * Phase 1: fields from fieldGroups (in order), skipping prompt-only fields.
 * Phase 2: remaining model attributes not yet included.
 *
 * @param {Object} ModelClass - Model class with static attributes
 * @param {Object} PromptClass - Prompt class with static fieldGroups
 * @returns {Object[]} Array of field definitions
 */
function buildOrderedFields(ModelClass, PromptClass) {
  const attrs = ModelClass.attributes || {}
  const fieldGroups = PromptClass.fieldGroups || {}
  const seen = new Set()
  const fields = []

  // Phase 1: fields from fieldGroups in order
  for (const group of Object.values(fieldGroups)) {
    for (const fieldName of group.fields) {
      if (seen.has(fieldName)) continue
      const attr = attrs[fieldName]
      if (!attr) continue
      if (isExcluded(attr)) continue

      seen.add(fieldName)
      fields.push(buildField(fieldName, attr, ModelClass))
    }
  }

  // Phase 2: remaining model attributes
  for (const [name, attr] of Object.entries(attrs)) {
    if (seen.has(name)) continue
    if (isExcluded(attr)) continue

    fields.push(buildField(name, attr, ModelClass))
  }

  return fields
}

/**
 * Generate a detail view schema from a model class and optional prompt class.
 *
 * Always returns a flat field list (no fieldsets). When PromptClass is provided,
 * its fieldGroups determine field ordering.
 *
 * @param {Object} ModelClass - Model class with static attributes, searchable, endpoint
 * @param {Object} [PromptClass] - Optional prompt class with fieldGroups
 * @returns {{ model: string, title: string, fields: Object[], endpoint: string, description: string }}
 */
export function generateDetailSchema(ModelClass, PromptClass) {
  const model = ModelClass.singularName
  const fields = PromptClass ? buildOrderedFields(ModelClass, PromptClass) : inferFields(ModelClass)

  return {
    model,
    title: humanize(model),
    endpoint: ModelClass.endpoint,
    fields
  }
}
