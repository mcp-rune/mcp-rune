/**
 * Find Model MCP App
 *
 * Single browseable surface for "show me records of X". Supports optional
 * text query, structured filters, columns, and pagination. Replaces the
 * separate list-model-app and search-model-app — routing decisions about
 * whether to use a search endpoint, fall back to list, or fetch a
 * nested-only collection now live behind `DataLayer.searchNormalized`.
 *
 * The handler never imports `SearchService` directly; everything goes
 * through the `DataLayer` seam, which `AppRegistry` wraps with
 * `SearchEnabledDataLayer` to add text-search routing transparently.
 *
 * Build: npm run build:apps:find-model-app
 */

import { z } from 'zod'

import { appResponseMeta, extractIds, formatAppSummary } from '#src/mcp/apps/lib/format-summary.js'
import { errorMeta } from '#src/mcp/apps/lib/helpers.js'
import {
  applyColumnSelection,
  generateListSchema,
  getAvailableColumnNames
} from '#src/mcp/apps/lib/list-schema.js'
import { createSelectionTools } from '#src/mcp/apps/lib/selection-tools.js'
import { getSearchConfig } from '#src/mcp/data-layer/api-extensions/search/index.js'
import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'
import type { ModelLayerFactory } from '#src/mcp/model-layer/model-layer.js'
import type { ToolResult } from '#src/mcp/tools/tool-result.js'
import * as logger from '#src/runtime/logger.js'

import type { AppModelClass, ListSchema } from '../lib/app-shared-entities.js'
import { createHtmlLoader } from '../lib/html-loader.js'

const MAX_PER_PAGE = 20
const getHtml = createHtmlLoader('find-model-app')

interface FindModelAppOptions {
  modelClasses: Record<string, AppModelClass>
  namespace: string
}

/** Create the find-model-app MCP App. */
export function createFindModelApp({ modelClasses, namespace }: FindModelAppOptions): unknown[] {
  const modelNames = Object.keys(modelClasses) as [string, ...string[]]
  const resourceUri = `ui://${namespace}/find-model-app`

  const columnInfo = Object.entries(modelClasses)
    .map(([name, MC]) => `${name}: ${getAvailableColumnNames(MC).join(', ')}`)
    .join('. ')

  const queryableModels = Object.entries(modelClasses)
    .filter(([, MC]) => getSearchConfig(MC)?.query)
    .map(([name]) => name)

  const findTool = {
    resourceUri,
    toolName: 'find_model_app',
    needsAuth: true,
    name: 'Find Records',
    description: 'Interactive table for finding records via text search and/or structured filters',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },

    toolDescription:
      `Use this when the user wants to find records visually in an interactive, paginated table they can filter and select from. ` +
      `Supports an optional text \`query\` (honored for models with a search backend) and structured \`filters\`. ` +
      `Renders an MCP App; the tool result contains a summary only — do not repeat record contents in your reply. ` +
      `For raw JSON suitable for programmatic processing, use search_records or find_records instead. ` +
      `For large-scale analysis use analysis_ingest. ` +
      `Call get_filters_guide first when the user wants to filter. ` +
      `Available models: ${modelNames.join(', ')}. ` +
      `Models supporting text \`query\`: ${queryableModels.length > 0 ? queryableModels.join(', ') : '(none — query is ignored)'}. ` +
      `Available columns — ${columnInfo}. ` +
      `Choose columns relevant to what the user wants to see, or omit to use defaults.`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to browse'),
      query: z
        .string()
        .describe('Optional text search query. Ignored for models without a search backend.')
        .optional(),
      columns: z
        .array(z.string())
        .describe('Column names to display. Omit to use defaults.')
        .optional(),
      filters: z
        .record(z.string(), z.unknown())
        .describe(
          'Structured filters (call get_filters_guide to see options). Omit to show all records.'
        )
        .optional(),
      page: z.number().describe('Page number (default: 1)').optional(),
      per_page: z
        .number()
        .describe(`Results per page (max: ${MAX_PER_PAGE}, default: ${MAX_PER_PAGE})`)
        .optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { dataLayer, modelLayer }: { dataLayer?: DataLayer; modelLayer?: ModelLayerFactory } = {}
    ): Promise<ToolResult> {
      const {
        model,
        query,
        filters = {},
        page = 1,
        per_page = MAX_PER_PAGE
      } = args as {
        model?: string
        query?: string
        filters?: Record<string, unknown>
        page?: number
        per_page?: number
      }

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

      const ModelClass = modelClasses[model]
      const fullSchema = generateListSchema(ModelClass)
      const schema: ListSchema & { model?: string } = applyColumnSelection(
        fullSchema,
        args.columns as string[] | undefined,
        ModelClass
      )
      schema.model = model
      const filterDefinitions = getSearchConfig(ModelClass)?.filters ?? {}

      const clampedPerPage = Math.min(Math.max(1, per_page), MAX_PER_PAGE)
      const hasFilters = Object.keys(filters).length > 0

      let records: Record<string, unknown>[] = []
      let pagination: { page: number; per_page: number; total: number } = {
        page,
        per_page: clampedPerPage,
        total: 0
      }

      if (dataLayer) {
        try {
          const result = await dataLayer.searchNormalized(model, query, filters, {
            page,
            perPage: clampedPerPage
          })
          records = result.records
          pagination = result.pagination
        } catch (err) {
          logger.warn('Failed to find records', {
            service: 'mcp-app',
            model,
            query: query || null,
            ...errorMeta(err)
          })
          records = []
        }
      }

      modelLayer?.(model).resolveDerivedFields(records)
      const totalRecords = pagination.total || records.length

      const parts: string[] = []
      if (query) parts.push(`query: "${query}"`)
      if (hasFilters) parts.push(`filters: ${Object.keys(filters).join(', ')}`)
      const queryContext = parts.length > 0 ? parts.join(', ') : 'no filters (showing all)'

      const totalPages =
        pagination.total > 0 ? Math.max(1, Math.ceil(pagination.total / pagination.per_page)) : 1
      const summary = formatAppSummary({
        toolName: 'find_model_app',
        count: records.length,
        ids: extractIds(records),
        page: pagination.page,
        totalPages,
        totalRecords,
        context: `Search context: ${queryContext}. Users may select records and click Send Selection (Replace or Add) — if they later refer to "selected" records, call get_selection to retrieve the stored IDs.`
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              records,
              pagination,
              query: query ?? null,
              activeFilters: filters,
              filterDefinitions
            })
          },
          { type: 'text', text: summary }
        ],
        _meta: appResponseMeta(summary)
      }
    },

    getHtml
  }

  const selectionTools = createSelectionTools('select_find_records', resourceUri, modelNames, {
    getHtml,
    modelClasses
  })

  return [findTool, ...selectionTools]
}
