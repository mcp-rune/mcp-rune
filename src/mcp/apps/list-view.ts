/**
 * List View MCP App
 *
 * Creates an MCP App that renders a browseable table of records for any model.
 * The schema is generated from model attributes, records are fetched from the API.
 *
 * Build: npm run build:engineer:apps
 */

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { defaultConvention } from '#src/mcp/api-conventions/index.js'
import { resolveDerivedFields } from '#src/mcp/apps/derived-fields.js'
import { errorMeta } from '#src/mcp/apps/helpers.js'
import {
  applyColumnSelection,
  generateListSchema,
  getAvailableColumnNames
} from '#src/mcp/apps/list-schema.js'
import { createSelectionTools } from '#src/mcp/apps/selection-tools.js'
import type { ApiClient } from '#src/mcp/search/search-client.js'
import type { SearchClient } from '#src/mcp/search/search-client.js'
import * as logger from '#src/services/logger.js'

import type { AppModelClass, ListSchema, ToolResult } from './types.js'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'list-view.html')

let _cachedHtml: string | null = null

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

interface ListViewOptions {
  modelClasses: Record<string, AppModelClass>
  namespace: string
}

/** Create the list view MCP App. */
export function createListViewApp({ modelClasses, namespace }: ListViewOptions): unknown[] {
  const modelNames = Object.keys(modelClasses) as [string, ...string[]]
  const resourceUri = `ui://${namespace}/list-records-view`

  const columnInfo = Object.entries(modelClasses)
    .map(([name, MC]) => `${name}: ${getAvailableColumnNames(MC).join(', ')}`)
    .join('. ')

  const listTool = {
    resourceUri,
    toolName: 'list_records_view',
    needsAuth: true,
    name: 'List Records',
    description: 'Interactive table for browsing records with optional filters',

    toolDescription:
      `List records in a visual, interactive table with pagination and optional filters. ` +
      `Use when the user explicitly asks to browse or view records visually in a table. ` +
      `When a workflow specifies a different tool (e.g., list_models), use that tool instead. ` +
      `Not suited for text search or nested-only models (e.g. scheduling) that lack a top-level list endpoint. ` +
      `Call get_filters_guide first when the user wants to filter. ` +
      `Available models: ${modelNames.join(', ')}. ` +
      `Available columns -- ${columnInfo}. ` +
      `Choose columns relevant to what the user wants to see, or omit to use defaults.`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to browse'),
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
      page: z.number().describe('Page number (default: 1)').optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { apiClient, searchClient }: { apiClient?: ApiClient; searchClient?: SearchClient } = {}
    ): Promise<ToolResult> {
      const {
        model,
        filters = {},
        page = 1
      } = args as {
        model?: string
        filters?: Record<string, unknown>
        page?: number
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

      const ModelClass = modelClasses[model]!
      const fullSchema = generateListSchema(ModelClass)
      const schema: ListSchema & { model?: string } = applyColumnSelection(
        fullSchema,
        args.columns as string[] | undefined,
        ModelClass
      )
      schema.model = model as string
      const filterDefinitions = ModelClass.search?.filters || {}

      let records: Record<string, unknown>[] = []
      let pagination: { page: number; per_page: number; total: number } = {
        page: page as number,
        per_page: 20,
        total: 0
      }
      const isNestedOnly = ModelClass.api?.nested?.nestedOnly
      const hasFilters = Object.keys(filters as Record<string, unknown>).length > 0

      if (isNestedOnly && searchClient) {
        // Nested-only models can't be listed via top-level GET -- use search endpoint
        try {
          const result = await searchClient.search(ModelClass as never, '', {
            page: page as number,
            perPage: 20,
            filters: hasFilters ? (filters as Record<string, unknown>) : undefined
          })
          records = result.records
          pagination = { ...pagination, ...result.pagination }
        } catch (err) {
          logger.warn('Failed to search list records', {
            service: 'mcp-app',
            model,
            page,
            ...errorMeta(err)
          })
          records = []
        }
      } else if (apiClient) {
        try {
          const queryParams = { page, per_page: 20, ...(filters as Record<string, unknown>) }
          const data = await apiClient.get(ModelClass.endpoint, queryParams)
          const convention = ModelClass.api?.convention ?? defaultConvention
          const normalized = convention.normalizeListResponse(data, {
            page: page as number,
            perPage: 20
          })
          records = normalized.records
          pagination = { ...pagination, ...normalized.pagination }
        } catch (err) {
          logger.warn('Failed to fetch list records', {
            service: 'mcp-app',
            model,
            page,
            ...errorMeta(err)
          })
          records = []
        }
      }

      const totalRecords = pagination.total || records.length
      resolveDerivedFields(records, ModelClass)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              records,
              pagination,
              activeFilters: filters,
              filterDefinitions
            })
          },
          {
            type: 'text',
            text:
              `${totalRecords} records displayed. ` +
              `Users may select records and click Send Selection -- if they later refer to "selected" records, call get_selection to retrieve the stored IDs.`
          }
        ]
      }
    },

    getHtml
  }

  const selectionTools = createSelectionTools('select_list_records', resourceUri, modelNames, {
    getHtml
  })

  return [listTool, ...selectionTools]
}
