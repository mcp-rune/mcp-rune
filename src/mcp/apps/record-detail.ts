/**
 * Record Detail MCP App
 *
 * Creates an MCP App that renders read-only detail cards for one or more model records.
 * The schema is generated from model attributes, records are fetched from the API in parallel.
 *
 * Supports three call patterns:
 *   find_records_app(model, ids: ['1','2','3'])  -- explicit IDs
 *   find_records_app(model)                      -- reads IDs from selection store
 *   find_records_app(model, ids: ['1'])          -- single record
 *
 * Build: npm run build:engineer:apps
 */

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { SearchApiClient } from '#src/core/api-client.js'
import { generateDetailSchema } from '#src/mcp/apps/detail-schema.js'
import { appResponseMeta, formatAppSummary } from '#src/mcp/apps/format-summary.js'
import { errorMeta } from '#src/mcp/apps/helpers.js'
import * as logger from '#src/services/logger.js'

import type { SelectionStore } from './selection-store.js'
import type { AppModelClass, DetailFieldDefinition, ToolResult } from './types.js'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'record-detail.html')
const MAX_RECORDS = 20

let _cachedHtml: string | null = null

/**
 * Resolve association field IDs to human-readable labels across multiple records.
 * Deduplicates API calls -- each unique (endpoint, id) pair is fetched once.
 *
 * Example: 3 records all referencing category_id=5 -> one GET /categories/5
 */
async function resolveAssociationLabelsBatch(
  fields: DetailFieldDefinition[],
  records: Record<string, unknown>[],
  apiClient: SearchApiClient
): Promise<void> {
  const assocFields = fields.filter((f) => f.association)
  if (assocFields.length === 0) return

  // Collect unique (endpoint, id) pairs across all records
  const lookups = new Map<string, { endpoint: string; id: unknown; labelField: string }>()
  for (const field of assocFields) {
    for (const record of records) {
      const id = record[field.name]
      if (id === null || id === undefined || id === '') continue
      const key = `${field.association!.endpoint}/${id}`
      if (!lookups.has(key)) {
        lookups.set(key, {
          endpoint: field.association!.endpoint,
          id,
          labelField: field.association!.labelField
        })
      }
    }
  }

  if (lookups.size === 0) return

  // Fetch all unique associations in parallel
  const resolved = new Map<string, string>()
  await Promise.all(
    Array.from(lookups.entries()).map(async ([key, { endpoint, id, labelField }]) => {
      try {
        const data = await apiClient.get(`${endpoint}/${id}`)
        const record = (data.data as Record<string, unknown>) || data
        const label = record[labelField] || record.name
        if (label) resolved.set(key, String(label))
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
      const key = `${field.association!.endpoint}/${id}`
      if (resolved.has(key)) {
        record[field.name] = resolved.get(key)
      }
    }
  }
}

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

interface RecordDetailOptions {
  modelClasses: Record<string, AppModelClass>
  promptClasses?: Record<string, unknown>
  namespace: string
}

/** Create the record detail MCP App. */
export function createRecordDetailApp({
  modelClasses,
  promptClasses,
  namespace
}: RecordDetailOptions): unknown {
  const modelNames = Object.keys(modelClasses) as [string, ...string[]]

  return {
    resourceUri: `ui://${namespace}/find-records-app`,
    toolName: 'find_records_app',
    needsAuth: true,
    name: 'Record Detail',
    description: 'Read-only detail cards for viewing one or more records',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },

    toolDescription:
      `Use this when the user wants to view one or more specific records as detail cards in an interactive MCP App. ` +
      `Pass explicit IDs, or omit ids to view the current selection from list/search apps. ` +
      `Renders an MCP App; the tool result contains a summary only — do not repeat record contents in your reply, and do NOT call find_records afterwards, the cards already display the data. ` +
      `For raw JSON suitable for programmatic processing, use find_records instead. ` +
      `Available models: ${modelNames.join(', ')}.`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to view'),
      ids: z
        .array(z.string())
        .optional()
        .describe('Record IDs to view. Omit to use current selection.')
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      {
        apiClient,
        selectionStore
      }: { apiClient?: SearchApiClient; selectionStore?: SelectionStore } = {}
    ): Promise<ToolResult> {
      const { model } = args
      let ids = args.ids as string[] | undefined

      if (!model || !modelClasses[model as string]) {
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
        const selection = selectionStore?.get(model as string)
        if (selection?.ids && selection.ids.length > 0) {
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

      const ModelClass = modelClasses[model as string]!
      const PromptClass = (promptClasses as Record<string, unknown> | undefined)?.[model as string]
      const schema = generateDetailSchema(
        ModelClass,
        PromptClass as Record<string, unknown> | undefined
      )

      // Cap at MAX_RECORDS
      let cappedMessage: string | null = null
      if (ids.length > MAX_RECORDS) {
        cappedMessage = `Showing first ${MAX_RECORDS} of ${ids.length} records.`
        ids = ids.slice(0, MAX_RECORDS)
      }

      // Fetch all records in parallel
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          if (!apiClient) throw new Error('No API client available')
          const data = await apiClient.get(`${ModelClass.api.endpoint}/${id}`)
          return (data.data as Record<string, unknown>) || data
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
          id: ids![i],
          ...errorMeta(result.reason as Error)
        })
        return { id: ids![i], error: (result.reason as Error).message }
      })

      // Batch-resolve association labels for all successful records
      const successfulRecords = records
        .filter((r): r is { data: Record<string, unknown> } => 'data' in r)
        .map((r) => r.data)
      if (successfulRecords.length > 0 && apiClient) {
        await resolveAssociationLabelsBatch(schema.fields, successfulRecords, apiClient)
      }

      const response: Record<string, unknown> = { schema, records }
      if (cappedMessage) response.cappedMessage = cappedMessage

      const successIds = records
        .filter((r): r is { data: Record<string, unknown> } => 'data' in r)
        .map((r) => {
          const id = r.data.id
          return typeof id === 'string' || typeof id === 'number' ? id : '?'
        })
      const summary = formatAppSummary({
        toolName: 'find_records_app',
        count: successIds.length,
        ids: successIds,
        totalRecords: ids.length,
        context: cappedMessage ?? undefined
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response)
          },
          {
            type: 'text',
            text: summary
          }
        ],
        _meta: appResponseMeta(summary)
      }
    },

    getHtml
  }
}
