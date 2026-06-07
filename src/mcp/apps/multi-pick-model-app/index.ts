/**
 * Multi-Pick Records MCP App
 *
 * Browse all records for a model and pick one or many.
 * Loads all records upfront, then filters client-side.
 * Best suited for small-to-medium sets (tags, categories, themes, locations).
 *
 * Build: npm run build:engineer:apps
 */

import { z } from 'zod'

import { errorMeta } from '#src/mcp/apps/lib/helpers.js'
import { createSelectionTools } from '#src/mcp/apps/lib/selection-tools.js'
import { getSearchConfig } from '#src/mcp/data-layer/api-extensions/search/index.js'
import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'
import * as logger from '#src/runtime/logger.js'

import type { AppModelClass, ToolResult } from '../lib/app-shared-entities.js'
import { createHtmlLoader } from '../lib/html-loader.js'

const MAX_RECORDS = 200
const getHtml = createHtmlLoader('multi-pick-model-app')

interface MultiSelectOptions {
  modelClasses: Record<string, AppModelClass>
  namespace: string
}

/** Create the multi-pick-model-app picker MCP App. */
export function createMultiPickModelApp({
  modelClasses,
  namespace
}: MultiSelectOptions): unknown[] {
  // Convention: only models with lookup support are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([, MC]) => {
      const fields = getSearchConfig(MC)?.lookup?.fields
      return Array.isArray(fields) && fields.length > 0
    })
  )
  const modelNames = Object.keys(eligible)

  if (modelNames.length === 0) return []

  const resourceUri = `ui://${namespace}/multi-pick-model-app`

  const multiSelectTool = {
    resourceUri,
    toolName: 'multi_pick_model_app',
    needsAuth: true,
    name: 'Multi-Pick Records',
    description: 'Browse and select records from a complete list',

    toolDescription:
      `Open a picker to browse and select records from scratch. ` +
      `IMPORTANT: Do NOT use this when the user says "selected" records, "those records", ` +
      `or references records they previously picked -- call get_selection first to check ` +
      `for a stored selection from a prior search/list view. ` +
      `Use this picker ONLY when the user needs to make a NEW selection. ` +
      `Best for small-to-medium sets (${modelNames.join(', ')}).`,

    toolInputSchema: {
      model: z.enum(modelNames as [string, ...string[]]).describe('Model to browse and select from')
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { dataLayer }: { dataLayer?: DataLayer } = {}
    ): Promise<ToolResult> {
      const { model } = args as { model?: string }

      if (!model || !eligible[model]) {
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

      const ModelClass = eligible[model]!
      let records: Array<{ id: unknown; display: string; [key: string]: unknown }> = []

      if (dataLayer) {
        try {
          const { records: rawRecords } = await dataLayer.searchNormalized(
            model,
            undefined,
            undefined,
            { page: 1, perPage: MAX_RECORDS }
          )
          records = rawRecords.map((record) => {
            const instance = new ModelClass(record)
            return {
              id: record.id,
              display: instance.displayValue,
              ...instance.lookupFields
            }
          })
        } catch (err) {
          logger.warn('Failed to fetch records for multi-pick-model-app', {
            service: 'mcp-app',
            model,
            ...errorMeta(err)
          })
          records = []
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ model, records })
          },
          {
            type: 'text',
            text: `Multi-select picker opened for ${model} with ${records.length} records. Select items and send.`
          }
        ]
      }
    },

    getHtml
  }

  const selectionTools = createSelectionTools(
    'select_multi_records',
    resourceUri,
    modelNames as [string, ...string[]],
    { getHtml }
  )

  return [multiSelectTool, ...selectionTools]
}
