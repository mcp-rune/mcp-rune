/**
 * Search View MCP App
 *
 * Creates an MCP App that renders text search results with optional structured
 * filters. Only available for models with `static search` defined.
 *
 * Build: npm run build:engineer:apps
 */

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { resolveDerivedFields } from '#src/mcp/apps/derived-fields.js'
import { errorMeta } from '#src/mcp/apps/helpers.js'
import {
  applyColumnSelection,
  generateListSchema,
  getAvailableColumnNames
} from '#src/mcp/apps/list-schema.js'
import { createSelectionTools } from '#src/mcp/apps/selection-tools.js'
import type { SearchClient } from '#src/mcp/search/search-client.js'
import * as logger from '#src/services/logger.js'

import type { AppModelClass, ListSchema, ToolResult } from './types.js'

const MAX_VIEW_PER_PAGE = 20
const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'search-view.html')

let _cachedHtml: string | null = null

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

interface SearchViewOptions {
  modelClasses: Record<string, AppModelClass>
  namespace: string
}

/** Create the search view MCP App. */
export function createSearchViewApp({ modelClasses, namespace }: SearchViewOptions): unknown[] {
  // Convention: only models with query search are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([, MC]) => MC.search?.query)
  )
  const modelNames = Object.keys(eligible)
  const resourceUri = `ui://${namespace}/search-view`

  if (modelNames.length === 0) return []

  const columnInfo = Object.entries(eligible)
    .map(([name, MC]) => `${name}: ${getAvailableColumnNames(MC).join(', ')}`)
    .join('. ')

  const searchTool = {
    resourceUri,
    toolName: 'search_records_view',
    needsAuth: true,
    name: 'Search Results',
    description: 'Display filtered search results with active filter indicators',

    toolDescription:
      `Search records by text and/or structured filters, displayed in a visual table with filter/query chips. ` +
      `Best for: interactive browsing where the user wants to visually review, filter, and select records. ` +
      `Call get_filters_guide first to see available structured filters for a model. ` +
      `Use this when the user explicitly asks to browse or view records visually. ` +
      `When a workflow specifies a different tool (e.g., search_records, list_models), use that tool instead. ` +
      `Results are paginated (${MAX_VIEW_PER_PAGE} per page) -- use page parameter to navigate. ` +
      `Available columns -- ${columnInfo}. ` +
      `Choose columns relevant to the user's query, or omit to use defaults.`,

    toolInputSchema: {
      model: z.enum(modelNames as [string, ...string[]]).describe('Model to display'),
      query: z.string().describe('Text search query (keyword or phrase)').optional(),
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
        .describe(`Results per page (max: ${MAX_VIEW_PER_PAGE}, default: ${MAX_VIEW_PER_PAGE})`)
        .optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { searchClient }: { searchClient?: SearchClient } = {}
    ): Promise<ToolResult> {
      const {
        model,
        query,
        filters = {},
        page = 1,
        per_page = MAX_VIEW_PER_PAGE
      } = args as {
        model?: string
        query?: string
        filters?: Record<string, unknown>
        page?: number
        per_page?: number
      }

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
      const fullSchema = generateListSchema(ModelClass)
      const schema: ListSchema & { model?: string } = applyColumnSelection(
        fullSchema,
        args.columns as string[] | undefined,
        ModelClass
      )
      schema.model = model!
      const filterDefinitions = ModelClass.search?.filters || {}

      let records: Record<string, unknown>[] = []
      const clampedPerPage = Math.min(per_page!, MAX_VIEW_PER_PAGE)
      let pagination: { page: number; per_page: number; total: number } = {
        page: page!,
        per_page: clampedPerPage,
        total: 0
      }
      const hasFilters = Object.keys(filters!).length > 0

      if (searchClient) {
        try {
          if (query || hasFilters) {
            const result = await searchClient.search(ModelClass as never, query || '', {
              page: page!,
              perPage: clampedPerPage,
              filters: hasFilters ? filters : undefined
            })
            records = result.records
            pagination = result.pagination
          } else {
            const result = await searchClient.list(ModelClass as never, {
              page: page!,
              perPage: clampedPerPage
            })
            records = result.records
            pagination = result.pagination
          }
        } catch (err) {
          logger.warn('Failed to search records', {
            service: 'mcp-app',
            model,
            query: query || null,
            ...errorMeta(err)
          })
          records = []
        }
      }

      const totalRecords = pagination.total || records.length
      resolveDerivedFields(records, ModelClass)
      const parts: string[] = []
      if (query) parts.push(`query: "${query}"`)
      if (hasFilters) parts.push(`filters: ${Object.keys(filters!).join(', ')}`)
      const summary = parts.length > 0 ? parts.join(', ') : 'no filters (showing all)'

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              records,
              pagination,
              query: query || null,
              activeFilters: filters,
              filterDefinitions
            })
          },
          {
            type: 'text',
            text:
              `Results displayed in the search view above (${totalRecords} records, ${summary}). ` +
              `Do not repeat or summarize the data. ` +
              `Users may select records and click Send Selection -- if they later refer to "selected" records, call get_selection to retrieve the stored IDs.`
          }
        ]
      }
    },

    getHtml
  }

  const selectionTools = createSelectionTools(
    'select_search_records',
    resourceUri,
    modelNames as [string, ...string[]],
    { getHtml }
  )

  return [searchTool, ...selectionTools]
}
