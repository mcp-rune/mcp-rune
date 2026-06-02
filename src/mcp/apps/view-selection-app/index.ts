/**
 * View Selection MCP App
 *
 * Visual surface for inspecting and managing the current `selectionStore`
 * contents. Two modes:
 *
 *   - ids-mode selection → resolve the records via DataLayer and render
 *     them in a compact table with a per-row × that calls
 *     `remove_from_selection`.
 *   - filter-mode selection → render the active filter chips + total
 *     count, with a "Materialize as IDs" action that calls
 *     `materialize_selection`.
 *
 * The app never imports SearchService directly — record resolution flows
 * through `DataLayer.searchNormalized`.
 *
 * Build: npm run build:apps:view-selection-app
 */

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { getSearchConfig } from '#src/api-extensions/search/index.js'
import type { DataLayer } from '#src/core/data-layer.js'
import { resolveDerivedFields } from '#src/core/derived-fields.js'
import { appResponseMeta, formatAppSummary } from '#src/mcp/apps/lib/format-summary.js'
import { errorMeta } from '#src/mcp/apps/lib/helpers.js'
import {
  applyColumnSelection,
  generateListSchema,
  getAvailableColumnNames
} from '#src/mcp/apps/lib/list-schema.js'
import type { SelectionStore } from '#src/mcp/apps/lib/selection-store.js'
import {
  createSelectionTools,
  createSharedSelectionTools
} from '#src/mcp/apps/lib/selection-tools.js'
import * as logger from '#src/services/logger.js'

import type { AppModelClass, ListSchema, ToolResult } from '../lib/types.js'

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist')
const HTML_PATH = path.join(DIST_DIR, 'view-selection-app.html')

let _cachedHtml: string | null = null

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

interface ViewSelectionOptions {
  modelClasses: Record<string, AppModelClass>
  namespace: string
}

export function createViewSelectionApp({
  modelClasses,
  namespace
}: ViewSelectionOptions): unknown[] {
  const modelNames = Object.keys(modelClasses) as [string, ...string[]]
  const resourceUri = `ui://${namespace}/view-selection-app`

  const columnInfo = Object.entries(modelClasses)
    .map(([name, MC]) => `${name}: ${getAvailableColumnNames(MC).join(', ')}`)
    .join('. ')

  const viewTool = {
    resourceUri,
    toolName: 'view_selection_app',
    needsAuth: true,
    name: 'View Selection',
    description: 'Inspect and manage the current record selection for a model',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },

    toolDescription:
      `Use this when the user wants to see what's currently selected, drop specific records, or convert a filter-based selection into explicit IDs. ` +
      `Renders the in-session selection store for the chosen model: ids-mode as a removable table, filter-mode as chips with a Materialize action. ` +
      `If no model is given, the app lists every active selection as a summary. ` +
      `For programmatic access without UI, use get_selection. ` +
      `Available models: ${modelNames.join(', ')}. ` +
      `Available columns — ${columnInfo}.`,

    toolInputSchema: {
      model: z
        .enum(modelNames)
        .describe('Model to inspect. Omit to summarize every selection.')
        .optional(),
      columns: z
        .array(z.string())
        .describe('Column names to display for ids-mode. Omit to use defaults.')
        .optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { dataLayer, selectionStore }: { dataLayer?: DataLayer; selectionStore?: SelectionStore } = {}
    ): Promise<ToolResult> {
      if (!selectionStore) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Selection store not available' }) }
          ],
          isError: true
        }
      }

      const model = args.model as string | undefined

      if (!model) {
        const all = selectionStore.getAll()
        const summary = Object.values(all).map((s) => ({
          model: s.model,
          mode: s.mode,
          total: s.total,
          createdAt: s.createdAt
        }))
        const summaryText = `Currently ${summary.length} active selection(s): ${
          summary.map((s) => `${s.model} (${s.mode}, ${s.total})`).join('; ') || 'none'
        }.`
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ view: 'summary', selections: summary })
            },
            { type: 'text', text: summaryText }
          ],
          _meta: appResponseMeta(summaryText)
        }
      }

      if (!modelClasses[model]) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Unknown model: ${model}. Available: ${modelNames.join(', ')}`
              })
            }
          ],
          isError: true
        }
      }

      const ModelClass = modelClasses[model]
      const fullSchema = generateListSchema(ModelClass)
      const schema: ListSchema & { model?: string } = applyColumnSelection(
        fullSchema,
        args.columns as string[] | undefined,
        ModelClass
      )
      schema.model = model
      const filterDefinitions = getSearchConfig(ModelClass)?.filters ?? {}

      const entry = selectionStore.get(model)
      if (!entry) {
        const text = `No selection currently stored for "${model}". Use find_model_app to select records first.`
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                view: 'empty',
                model,
                schema,
                filterDefinitions
              })
            },
            { type: 'text', text }
          ],
          _meta: appResponseMeta(text)
        }
      }

      if (entry.mode === 'filter') {
        const summary = `Filter-mode selection for ${model}: ${entry.total} record(s) match ${
          Object.keys(entry.filters).length
        } filter(s). Materialize to prune individual rows.`
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                view: 'filter',
                model,
                schema,
                filterDefinitions,
                filters: entry.filters,
                total: entry.total,
                createdAt: entry.createdAt
              })
            },
            { type: 'text', text: summary }
          ],
          _meta: appResponseMeta(summary)
        }
      }

      // ids-mode: resolve records for display
      let records: Record<string, unknown>[]
      if (dataLayer && entry.ids.length > 0) {
        try {
          const result = await dataLayer.searchNormalized(
            model,
            undefined,
            { id: entry.ids },
            { page: 1, perPage: Math.max(entry.ids.length, 1) }
          )
          records = result.records
        } catch (err) {
          logger.warn('Failed to resolve selection records', {
            service: 'mcp-app',
            model,
            ...errorMeta(err)
          })
          records = entry.ids.map((id) => ({ id }))
        }
      } else {
        records = entry.ids.map((id) => ({ id }))
      }
      resolveDerivedFields(records, ModelClass)

      const summary = formatAppSummary({
        toolName: 'view_selection_app',
        count: records.length,
        ids: entry.ids,
        totalRecords: entry.total,
        context:
          'Each row has an × to remove it from the selection; "Clear selection" empties the entry. Use bulk_action_models with these IDs to act on them.'
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              view: 'ids',
              model,
              schema,
              filterDefinitions,
              records,
              ids: entry.ids,
              total: entry.total,
              createdAt: entry.createdAt
            })
          },
          { type: 'text', text: summary }
        ],
        _meta: appResponseMeta(summary)
      }
    },

    getHtml
  }

  // view-selection-app's per-app select tool exists for symmetry; in
  // practice the UI mainly invokes the shared `remove_from_selection`,
  // `clear_selection`, and `materialize_selection` tools.
  const selectionTools = createSelectionTools('select_view_records', resourceUri, modelNames, {
    getHtml,
    modelClasses
  })

  // `createSelectionTools` already returns the shared tools (deduped by
  // AppRegistry), so we explicitly re-export `createSharedSelectionTools`
  // here for any wiring that wants only the management surface.
  void createSharedSelectionTools

  return [viewTool, ...selectionTools]
}
