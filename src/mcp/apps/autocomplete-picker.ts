/**
 * Autocomplete Picker MCP App
 *
 * Type-ahead search to find and select records by text.
 * Supports single-model search (model param) and cross-model group search
 * (group param) via SearchService.groupSearch().
 *
 * Build: npm run build:apps:lib
 */

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { SearchApiClient } from '#src/core/api-client.js'
import { errorMeta } from '#src/mcp/apps/helpers.js'
import { createSelectionTools } from '#src/mcp/apps/selection-tools.js'
import type { SearchService } from '#src/mcp/search/search-service.js'
import * as logger from '#src/services/logger.js'

import type { AppModelClass, ToolResult } from './types.js'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'autocomplete-picker.html')

let _cachedHtml: string | null = null

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

/**
 * Build a typeToModel mapping from modelClasses.
 *
 * Inverts each model's `search.query.modelName` to map entity type -> model registry key.
 * For models with array modelName (e.g. TitleModel: ['episode', 'feature']),
 * each value maps to the same registry key.
 */
function buildTypeToModelMap(modelClasses: Record<string, AppModelClass>): Record<string, string> {
  const typeToModel: Record<string, string> = {}
  for (const [key, ModelClass] of Object.entries(modelClasses)) {
    const modelName = ModelClass.search?.query?.modelName
    if (modelName) {
      const names = Array.isArray(modelName) ? modelName : [modelName]
      for (const name of names) {
        typeToModel[name] = key
      }
    } else {
      // Default: registry key maps to itself
      typeToModel[key] = key
    }
  }
  return typeToModel
}

interface SearchGroupConfig {
  name: string
  description?: string
  typeField: string
  models?: string[]
  [key: string]: unknown
}

interface AutocompletePickerOptions {
  modelClasses: Record<string, AppModelClass>
  searchGroups?: Record<string, SearchGroupConfig>
  namespace: string
}

/** Create the autocomplete picker MCP App. */
export function createAutocompletePickerApp({
  modelClasses,
  searchGroups = {},
  namespace
}: AutocompletePickerOptions): unknown[] {
  // Convention: only models with lookup support are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([, MC]) => MC.supportsLookup)
  )
  const modelNames = Object.keys(eligible)
  const groupNames = Object.keys(searchGroups)
  const hasGroups = groupNames.length > 0

  if (modelNames.length === 0 && !hasGroups) return []

  const resourceUri = `ui://${namespace}/autocomplete-picker`

  // Build typeToModel mapping for group mode
  const typeToModel = hasGroups ? buildTypeToModelMap(eligible) : {}

  // Build tool input schema -- model is optional when groups exist
  const toolInputSchema: Record<string, z.ZodTypeAny> = {
    query: z.string().describe('Initial search query (optional)').optional(),
    limit: z.number().describe('Max results per search (default: 10)').optional()
  }

  if (hasGroups) {
    toolInputSchema.model = z
      .enum(modelNames as [string, ...string[]])
      .describe('Model to search (use this OR group, not both)')
      .optional()
    toolInputSchema.group = z
      .enum(groupNames as [string, ...string[]])
      .describe(
        `Cross-model search group. Use "${groupNames[0]}" when the user wants to search across ` +
          `all entity types (${searchGroups[groupNames[0]!]?.models?.join(', ') || 'multiple models'})`
      )
      .optional()
  } else {
    toolInputSchema.model = z.enum(modelNames as [string, ...string[]]).describe('Model to search')
  }

  // Build tool description with group guidance
  let toolDesc =
    `Find specific records by typing text (type-ahead search). ` +
    `Best for: finding a specific record by name/title, quick lookup, selecting records for follow-up operations. ` +
    `When a workflow specifies a different tool (e.g., search_records, list_models), use that tool instead. ` +
    `Opens a search UI for ${modelNames.join(', ')}. Users type to search, check results, and send their selection. ` +
    `Pass a query to pre-populate results, or omit to start with an empty search.`

  if (hasGroups) {
    const groupDescs = groupNames.map((name) => {
      const g = searchGroups[name]!
      return `"${name}" -- ${g.description || g.name}`
    })
    toolDesc +=
      ` When the user says "search the catalogue", "find a catalogue item", or wants to search across ` +
      `brands/series/episodes/features/collections without specifying a single model, use the group parameter. ` +
      `Available groups: ${groupDescs.join('; ')}. ` +
      `Provide exactly one of model or group.`
  }

  const autocompleteTool = {
    resourceUri,
    toolName: 'autocomplete_picker',
    needsAuth: true,
    name: 'Autocomplete Picker',
    description: 'Type-ahead search to find and select records',

    toolDescription: toolDesc,

    toolInputSchema,

    async handleToolCall(
      args: Record<string, unknown> = {},
      { searchClient }: { apiClient?: SearchApiClient; searchClient?: SearchService } = {}
    ): Promise<ToolResult> {
      const {
        model,
        group,
        query,
        limit = 10
      } = args as {
        model?: string
        group?: string
        query?: string
        limit?: number
      }

      // Validate: exactly one of model or group
      if (hasGroups && model && group) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Provide either model or group, not both.' })
            }
          ]
        }
      }

      if (!model && !group) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: hasGroups
                  ? `Provide either model (${modelNames.join(', ')}) or group (${groupNames.join(', ')}).`
                  : `Unknown model: ${model}. Available: ${modelNames.join(', ')}`
              })
            }
          ]
        }
      }

      // --- Group search path ---
      if (group) {
        const groupConfig = searchGroups[group]
        if (!groupConfig) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Unknown group: ${group}. Available: ${groupNames.join(', ')}`
                })
              }
            ]
          }
        }

        let results: Array<{ id: unknown; display: string; entityType: unknown }> = []
        if (searchClient && query) {
          try {
            const { records } = await searchClient.groupSearch(group, query, { perPage: limit })
            results = records.map((record) => ({
              id: record.id,
              display: String(record.name || record.title || `ID: ${record.id}`),
              entityType: record[groupConfig.typeField]
            }))
          } catch (err) {
            logger.warn('Failed to group search for autocomplete', {
              service: 'mcp-app',
              group,
              query,
              ...errorMeta(err)
            })
            results = []
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                group,
                groupLabel: groupConfig.name,
                typeField: groupConfig.typeField,
                typeToModel,
                results,
                query: query || '',
                limit
              })
            },
            {
              type: 'text',
              text: query
                ? `Autocomplete picker opened for ${groupConfig.name} with ${results.length} results for "${query}".`
                : `Autocomplete picker opened for ${groupConfig.name}. Type to search.`
            }
          ]
        }
      }

      // --- Single-model search path (uses SearchService.lookup) ---
      if (!eligible[model!]) {
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

      const ModelClass = eligible[model!]!
      const searchFields = ModelClass.search?.lookup?.fields || []
      let results: Array<{ id: unknown; display: string; [key: string]: unknown }> = []

      if (searchClient && query) {
        try {
          const { records } = await searchClient.lookup(ModelClass as never, query, {
            perPage: limit
          })
          results = records.map((record) => {
            const instance = new ModelClass(record)
            return {
              id: record.id,
              display: instance.displayValue,
              ...instance.lookupFields
            }
          })
        } catch (err) {
          logger.warn('Failed to lookup for autocomplete', {
            service: 'mcp-app',
            model,
            query,
            ...errorMeta(err)
          })
          results = []
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              model,
              searchFields,
              results,
              query: query || '',
              limit
            })
          },
          {
            type: 'text',
            text: query
              ? `Autocomplete picker opened for ${model} with ${results.length} results for "${query}".`
              : `Autocomplete picker opened for ${model}. Type to search.`
          }
        ]
      }
    },

    getHtml
  }

  const selectionTools = createSelectionTools(
    'select_autocomplete_records',
    resourceUri,
    modelNames as [string, ...string[]],
    { getHtml }
  )

  return [autocompleteTool, ...selectionTools]
}
