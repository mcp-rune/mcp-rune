/**
 * Record Detail MCP App
 *
 * Creates an MCP App that renders read-only detail cards for one or more model records.
 * The schema is generated from model attributes, records are fetched from the API in parallel.
 *
 * Supports three call patterns:
 *   view_records(model, ids: ['1','2','3'])  — explicit IDs
 *   view_records(model)                      — reads IDs from selection store
 *   view_records(model, ids: ['1'])          — single record (visually identical to old view_record)
 *
 * Build: npm run build:engineer:apps
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { generateDetailSchema } from '#lib/mcp/apps/detail-schema.js'
import * as logger from '#lib/services/logger.js'
import { errorMeta } from '#lib/mcp/apps/helpers.js'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'record-detail.html')
const MAX_RECORDS = 20

let _cachedHtml = null

/**
 * Resolve association field IDs to human-readable labels across multiple records.
 * Deduplicates API calls — each unique (endpoint, id) pair is fetched once.
 *
 * Example: 3 records all referencing category_id=5 → one GET /categories/5
 *
 * @param {Object[]} fields - Schema fields (may contain `association` metadata)
 * @param {Object[]} records - Array of fetched records with raw ID values
 * @param {Object} apiClient - API client with .get()
 */
async function resolveAssociationLabelsBatch(fields, records, apiClient) {
  const assocFields = fields.filter((f) => f.association)
  if (assocFields.length === 0) return

  // Collect unique (endpoint, id) pairs across all records
  const lookups = new Map() // "endpoint/id" → { endpoint, id, labelField }
  for (const field of assocFields) {
    for (const record of records) {
      const id = record[field.name]
      if (id === null || id === undefined || id === '') continue
      const key = `${field.association.endpoint}/${id}`
      if (!lookups.has(key)) {
        lookups.set(key, {
          endpoint: field.association.endpoint,
          id,
          labelField: field.association.labelField
        })
      }
    }
  }

  if (lookups.size === 0) return

  // Fetch all unique associations in parallel
  const resolved = new Map() // "endpoint/id" → label string
  await Promise.all(
    Array.from(lookups.entries()).map(async ([key, { endpoint, id, labelField }]) => {
      try {
        const data = await apiClient.get(`${endpoint}/${id}`)
        const record = data.data || data
        const label = record[labelField] || record.name
        if (label) resolved.set(key, label)
      } catch (err) {
        logger.warn('Failed to resolve association label', {
          service: 'mcp-app',
          endpoint,
          id,
          ...errorMeta(err)
        })
        // Keep raw ID on failure
      }
    })
  )

  // Apply resolved labels to all records
  for (const field of assocFields) {
    for (const record of records) {
      const id = record[field.name]
      if (id === null || id === undefined || id === '') continue
      const key = `${field.association.endpoint}/${id}`
      if (resolved.has(key)) {
        record[field.name] = resolved.get(key)
      }
    }
  }
}

function getHtml() {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

/**
 * Create the record detail MCP App.
 *
 * @param {Object} options
 * @param {Object} options.modelClasses - Map of model name → ModelClass
 * @returns {Object} App definition for AppRegistry
 */
export function createRecordDetailApp({ modelClasses, promptClasses, namespace }) {
  const modelNames = Object.keys(modelClasses)

  return {
    resourceUri: `ui://${namespace}/record-detail`,
    toolName: 'view_records',
    needsAuth: true,
    name: 'Record Detail',
    description: 'Read-only detail cards for viewing one or more records',

    toolDescription:
      `Show one or more records in visual, read-only detail cards. ` +
      `Pass explicit IDs, or omit ids to view the current selection from list/search views. ` +
      `Use when the user explicitly asks to view record details visually. ` +
      `When a workflow specifies a different tool (e.g., find_model), use that tool instead. ` +
      `Do NOT call find_model after this — the cards already display all the data. ` +
      `Available models: ${modelNames.join(', ')}.`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to view'),
      ids: z
        .array(z.string())
        .optional()
        .describe('Record IDs to view. Omit to use current selection.')
    },

    async handleToolCall(args = {}, { apiClient, selectionStore } = {}) {
      const { model } = args
      let { ids } = args

      if (!model || !modelClasses[model]) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Unknown model: ${model}. Available: ${modelNames.join(', ')}`
              })
            }
          ]
        }
      }

      // Fall back to selection store when no explicit IDs
      if (!ids || ids.length === 0) {
        const selection = selectionStore?.get(model)
        if (selection?.ids?.length > 0) {
          ids = selection.ids.map(String)
        }
      }

      if (!ids || ids.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `No IDs provided and no selection found for ${model}.`
              })
            }
          ]
        }
      }

      const ModelClass = modelClasses[model]
      const PromptClass = promptClasses?.[model]
      const schema = generateDetailSchema(ModelClass, PromptClass)

      // Cap at MAX_RECORDS
      let cappedMessage = null
      if (ids.length > MAX_RECORDS) {
        cappedMessage = `Showing first ${MAX_RECORDS} of ${ids.length} records.`
        ids = ids.slice(0, MAX_RECORDS)
      }

      // Fetch all records in parallel
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          if (!apiClient) throw new Error('No API client available')
          const data = await apiClient.get(`${ModelClass.endpoint}/${id}`)
          return data.data || data
        })
      )

      // Build records array: { data } or { id, error }
      const records = results.map((result, i) => {
        if (result.status === 'fulfilled') {
          return { data: result.value }
        }
        logger.warn('Failed to fetch record for detail view', {
          service: 'mcp-app',
          model,
          id: ids[i],
          ...errorMeta(result.reason)
        })
        return { id: ids[i], error: result.reason.message }
      })

      // Batch-resolve association labels for all successful records
      const successfulRecords = records.filter((r) => r.data).map((r) => r.data)
      if (successfulRecords.length > 0 && apiClient) {
        await resolveAssociationLabelsBatch(schema.fields, successfulRecords, apiClient)
      }

      const response = { schema, records }
      if (cappedMessage) response.cappedMessage = cappedMessage

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response)
          }
        ]
      }
    },

    getHtml
  }
}
