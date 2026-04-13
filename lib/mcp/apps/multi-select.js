/**
 * Multi-Select Picker MCP App
 *
 * Browse all records for a model and pick one or many.
 * Loads all records upfront, then filters client-side.
 * Best suited for small-to-medium sets (tags, categories, themes, locations).
 *
 * Build: npm run build:engineer:apps
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { createSelectionTools } from '#lib/mcp/apps/selection-tools.js'
import * as logger from '#lib/services/logger.js'
import { errorMeta } from '#lib/mcp/apps/helpers.js'
import { defaultConvention } from '#lib/mcp/api-conventions/index.js'

const MAX_RECORDS = 200
const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'multi-select.html')

let _cachedHtml = null

function getHtml() {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

/**
 * Create the multi-select picker MCP App.
 *
 * @param {Object} options
 * @param {Object} options.modelClasses - Map of model name → ModelClass (all models; filtered internally)
 * @returns {Object[]} App definitions for AppRegistry
 */
export function createMultiSelectApp({ modelClasses, namespace }) {
  // Convention: only models with autocomplete support are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([, MC]) => MC.supportsAutocomplete)
  )
  const modelNames = Object.keys(eligible)

  if (modelNames.length === 0) return []

  const resourceUri = `ui://${namespace}/multi-select`

  const multiSelectTool = {
    resourceUri,
    toolName: 'multi_select_picker',
    needsAuth: true,
    name: 'Multi-Select Picker',
    description: 'Browse and select records from a complete list',

    toolDescription:
      `Open a picker to browse and select records from scratch. ` +
      `IMPORTANT: Do NOT use this when the user says "selected" records, "those records", ` +
      `or references records they previously picked — call get_selection first to check ` +
      `for a stored selection from a prior search/list view. ` +
      `Use this picker ONLY when the user needs to make a NEW selection. ` +
      `Best for small-to-medium sets (${modelNames.join(', ')}).`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to browse and select from')
    },

    async handleToolCall(args = {}, { apiClient, searchClient } = {}) {
      const { model } = args

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

      const ModelClass = eligible[model]
      let records = []

      if (searchClient) {
        try {
          const result = await searchClient.list(ModelClass, { perPage: MAX_RECORDS })
          records = result.records.map((record) => {
            const instance = new ModelClass(record)
            return {
              id: record.id,
              display: instance.displayValue,
              ...instance.autocompleteFields
            }
          })
        } catch (err) {
          logger.warn('Failed to list records for multi-select', {
            service: 'mcp-app',
            model,
            ...errorMeta(err)
          })
          records = []
        }
      } else if (apiClient) {
        try {
          const data = await apiClient.get(ModelClass.endpoint, { per_page: MAX_RECORDS })
          const convention = ModelClass.api?.convention ?? defaultConvention
          const { records: rawRecords } = convention.normalizeListResponse(data, {
            page: 1,
            perPage: MAX_RECORDS
          })
          records = rawRecords.map((record) => {
            const instance = new ModelClass(record)
            return {
              id: record.id,
              display: instance.displayValue,
              ...instance.autocompleteFields
            }
          })
        } catch (err) {
          logger.warn('Failed to fetch records for multi-select', {
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

  const selectionTools = createSelectionTools('select_multi_records', resourceUri, modelNames, {
    getHtml
  })

  return [multiSelectTool, ...selectionTools]
}
