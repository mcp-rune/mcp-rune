/**
 * List Schema Generator
 *
 * Generates list view schemas from model attributes and configuration.
 * Used by the list view MCP App to dynamically render record tables.
 *
 * The schema is a pure data structure -- no API calls, no side effects.
 */

import { getSearchConfig } from '#src/api-extensions/search/index.js'

import { humanize } from './helpers.js'
import type { AppModelClass, ColumnDefinition, ListSchema } from './types.js'

/**
 * Infer which columns to show in a list view from model attributes.
 * Picks the most useful fields for a compact table view.
 */
function inferColumns(ModelClass: AppModelClass): ColumnDefinition[] {
  const attrs = ModelClass.attributes || {}
  const columns: ColumnDefinition[] = []

  for (const [name, attr] of Object.entries(attrs)) {
    if (attr.prompt_visible === false && !attr.derived) continue
    // Skip long text fields, file uploads, and hidden fields
    if (attr.type === 'text' && name !== 'description') continue
    if (attr.format === 'base64') continue
    if (name === 'id') continue

    columns.push({
      name,
      label: attr.label || humanize(name),
      type: attr.type || 'string',
      sortable: !attr.derived,
      ...(attr.enumValues && { enumValues: attr.enumValues }),
      ...(attr.derived && { derived: attr.derived }),
      ...(attr.format && { format: attr.format })
    })
  }

  return columns
}

/** Get all selectable column names for a model. */
export function getAvailableColumnNames(ModelClass: AppModelClass): string[] {
  return inferColumns(ModelClass).map((c) => c.name)
}

/** Filter a schema's columns to a requested subset. */
export function applyColumnSelection(
  schema: ListSchema,
  selectedColumns: string[] | undefined,
  ModelClass: AppModelClass
): ListSchema {
  const columnsToUse = selectedColumns || ModelClass.defaultColumns
  if (!columnsToUse) return schema

  const columnMap = new Map(schema.columns.map((c) => [c.name, c]))
  const filtered = columnsToUse
    .map((name) => columnMap.get(name))
    .filter(Boolean) as ColumnDefinition[]

  // If filtering produced nothing (all unknown names), fall back to defaults or full schema
  if (filtered.length === 0) {
    if (selectedColumns && ModelClass.defaultColumns) {
      const defaultFiltered = ModelClass.defaultColumns
        .map((name) => columnMap.get(name))
        .filter(Boolean) as ColumnDefinition[]
      if (defaultFiltered.length > 0) return { ...schema, columns: defaultFiltered }
    }
    return schema
  }

  return { ...schema, columns: filtered }
}

export function generateListSchema(ModelClass: AppModelClass): ListSchema {
  const model = ModelClass.singularName
  const columns = inferColumns(ModelClass)
  const searchFields = getSearchConfig(ModelClass)?.lookup?.fields || []

  return {
    model,
    title: humanize(ModelClass.api.endpoint),
    endpoint: ModelClass.api.endpoint,
    columns,
    searchFields
  }
}
