/**
 * Shared selection tool factory for MCP Apps.
 *
 * Three layers of tools:
 *
 *   1. Per-app `select_*_records` — bound to a resourceUri so the host
 *      enforces that only the owning app can call them. Each table-app
 *      factory (find-model-app, view-selection-app) instantiates its own
 *      via `createSelectionTools(...)`.
 *   2. Model-visible read tool `get_selection` — returned by every call
 *      and deduplicated by `AppRegistry`'s tool-name Map.
 *   3. Model-visible write tools `add_to_selection`, `remove_from_selection`,
 *      `clear_selection`, `materialize_selection` — returned by every call
 *      and deduplicated identically. Available via `createSharedSelectionTools()`
 *      for callers that want only the shared surface (no per-app select tool).
 *
 * Usage (inside an app factory):
 *
 *   const resourceUri = `ui://${namespace}/multi-pick-model-app`
 *   const selectionTools = createSelectionTools(
 *     'select_multi_records',   // per-app select tool name
 *     resourceUri,              // host enforces app-only access
 *     modelNames,               // enum constraint for the model arg
 *     { getHtml }               // shared with the main app tool
 *   )
 *   return [multiSelectTool, ...selectionTools]
 */

import { z } from 'zod'

import type { AppModelClass, AppToolContext, ToolResult } from './app-shared-entities.js'
import { type SelectionEntry, SelectionMergeError } from './selection-store.js'

interface AppToolDefinition {
  resourceUri?: string
  toolName: string
  needsAuth: boolean
  visibility: string[]
  name: string
  description: string
  toolDescription: string
  toolInputSchema: Record<string, z.ZodTypeAny>
  handleToolCall(args: Record<string, unknown>, context: AppToolContext): Promise<ToolResult>
  getHtml?: () => string
}

function noSelectionStore(): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: 'Selection store not available' }) }]
  }
}

function selectionToText(selection: SelectionEntry | null, message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: true, selection, message })
      }
    ]
  }
}

/**
 * Create the per-app select tool plus the shared read/write surface.
 *
 * The per-app `select_*_records` tool is `visibility: ['app']` and bound
 * to a `resourceUri`. The shared tools are `visibility: ['model']` and
 * unbound — `AppRegistry`'s Map deduplicates by `toolName` so only one
 * copy is registered even though every factory call returns them.
 */
export function createSelectionTools(
  selectToolName: string,
  resourceUri: string,
  modelNames: [string, ...string[]],
  { getHtml, modelClasses }: { getHtml: () => string; modelClasses?: Record<string, AppModelClass> }
): AppToolDefinition[] {
  const selectTool: AppToolDefinition = {
    resourceUri,
    toolName: selectToolName,
    needsAuth: false,
    visibility: ['app'],
    name: 'Record Selection',
    description: 'Store record selection server-side',

    toolDescription:
      'Save the current record selection (specific IDs or filter-based) for use in follow-up tool calls. ' +
      'Strategy=replace overwrites the prior selection; strategy=add unions with it (ids-mode only).',

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model being selected'),
      mode: z
        .enum(['ids', 'filter'])
        .describe('Selection mode: specific IDs or all matching a filter'),
      ids: z.array(z.string()).describe('Selected record IDs (when mode is ids)').optional(),
      filters: z
        .record(z.string(), z.unknown())
        .describe('Active filters (when mode is filter)')
        .optional(),
      total: z.number().describe('Total number of selected records').optional(),
      strategy: z
        .enum(['replace', 'add'])
        .describe(
          'How to combine with any existing selection for this model. Defaults to replace. ' +
            'Use add only when mode=ids and no filter-mode selection exists.'
        )
        .optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { selectionStore }: AppToolContext = {}
    ) {
      if (!selectionStore) return noSelectionStore()

      try {
        const selection = selectionStore.set(
          args as {
            model: string
            mode: string
            ids?: string[]
            filters?: Record<string, unknown>
            total?: number
            strategy?: 'replace' | 'add'
          }
        )
        const total = selection.total || (selection.ids ? selection.ids.length : 0)
        const strategy = (args.strategy as string | undefined) ?? 'replace'
        const verb = strategy === 'add' ? 'merged into the selection of' : 'selected'
        return selectionToText(
          selection,
          `User ${verb} ${total} ${selection.model} record(s). Confirm the selection is saved and let them know what they can do with it.`
        )
      } catch (err) {
        if (err instanceof SelectionMergeError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            isError: true
          }
        }
        throw err
      }
    },

    getHtml
  }

  return [selectTool, ...createSharedSelectionTools(modelClasses)]
}

/**
 * The four model-visible selection-management tools plus `get_selection`.
 *
 * Returned independently from `createSelectionTools` so callers that
 * don't want a per-app select tool (e.g., a host-level integration) can
 * still register the shared surface. AppRegistry deduplicates by tool
 * name, so emitting these from every factory call is safe.
 */
export function createSharedSelectionTools(
  modelClasses?: Record<string, AppModelClass>
): AppToolDefinition[] {
  const getSelectionTool: AppToolDefinition = {
    toolName: 'get_selection',
    needsAuth: false,
    visibility: ['model'],
    name: 'Record Selection',
    description: 'Retrieve stored record selections',

    toolDescription:
      'Retrieve record IDs from a stored selection. ' +
      'IMPORTANT: Call this FIRST whenever the user mentions "selected" records, ' +
      '"those records", or references records they previously picked -- ' +
      'it returns the IDs needed for bulk_action_models. ' +
      "Pass a model name to get that model's selection, or omit to get all. " +
      'To inspect the current selection visually, use view_selection_app instead.',

    toolInputSchema: {
      model: z
        .string()
        .describe('Model name to get selection for. Omit to get all selections.')
        .optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { selectionStore }: AppToolContext = {}
    ) {
      if (!selectionStore) return noSelectionStore()

      if (args.model) {
        const selection = selectionStore.get(args.model as string)
        if (!selection) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  selection: null,
                  message: `No selection for ${args.model}`
                })
              }
            ]
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ selection }) }]
        }
      }

      const selections = selectionStore.getAll()
      const count = Object.keys(selections).length
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              selections,
              count,
              message: count === 0 ? 'No active selections' : `${count} active selection(s)`
            })
          }
        ]
      }
    }
  }

  const addToSelectionTool: AppToolDefinition = {
    toolName: 'add_to_selection',
    needsAuth: false,
    visibility: ['model'],
    name: 'Add to Selection',
    description: 'Append record IDs to an existing selection',

    toolDescription:
      'Add record IDs to the current selection for a model, unioning with any IDs already stored. ' +
      'Fails if the existing selection is filter-mode (a predicate cannot be merged with explicit IDs) — ' +
      'materialize it first with materialize_selection, or use the per-app select tool with strategy=replace.',

    toolInputSchema: {
      model: z.string().describe('Model to add IDs to'),
      ids: z.array(z.string()).describe('Record IDs to add')
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { selectionStore }: AppToolContext = {}
    ) {
      if (!selectionStore) return noSelectionStore()
      const model = args.model as string
      const ids = (args.ids as string[]) ?? []
      try {
        const selection = selectionStore.set({ model, mode: 'ids', ids, strategy: 'add' })
        return selectionToText(
          selection,
          `Added ${ids.length} ID(s) to ${model} selection. Total is now ${selection.total}.`
        )
      } catch (err) {
        if (err instanceof SelectionMergeError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            isError: true
          }
        }
        throw err
      }
    }
  }

  const removeFromSelectionTool: AppToolDefinition = {
    toolName: 'remove_from_selection',
    needsAuth: false,
    visibility: ['model'],
    name: 'Remove from Selection',
    description: 'Drop record IDs from an existing selection',

    toolDescription:
      'Remove record IDs from the current ids-mode selection for a model. ' +
      'No-op when the selection is filter-mode (the predicate is the unit). ' +
      'Removing every remaining ID clears the selection entry entirely.',

    toolInputSchema: {
      model: z.string().describe('Model to drop IDs from'),
      ids: z.array(z.string()).describe('Record IDs to remove')
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { selectionStore }: AppToolContext = {}
    ) {
      if (!selectionStore) return noSelectionStore()
      const model = args.model as string
      const ids = (args.ids as string[]) ?? []
      const selection = selectionStore.removeIds(model, ids)
      if (!selection) {
        return selectionToText(
          null,
          `Removed ${ids.length} ID(s) from ${model} selection. Selection is now empty.`
        )
      }
      return selectionToText(
        selection,
        `Removed ${ids.length} ID(s) from ${model} selection. ${selection.total} remain.`
      )
    }
  }

  const clearSelectionTool: AppToolDefinition = {
    toolName: 'clear_selection',
    needsAuth: false,
    visibility: ['model'],
    name: 'Clear Selection',
    description: 'Clear stored record selections',

    toolDescription:
      'Clear the selection for a given model, or omit `model` to clear every model selection in the session.',

    toolInputSchema: {
      model: z
        .string()
        .describe('Model name to clear. Omit to clear all selections in the session.')
        .optional()
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { selectionStore }: AppToolContext = {}
    ) {
      if (!selectionStore) return noSelectionStore()
      const model = args.model as string | undefined
      selectionStore.clear(model)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              message: model ? `Cleared selection for ${model}.` : 'Cleared all selections.'
            })
          }
        ]
      }
    }
  }

  const materializeSelectionTool: AppToolDefinition = {
    toolName: 'materialize_selection',
    needsAuth: true,
    visibility: ['model'],
    name: 'Materialize Selection',
    description: 'Resolve a filter-mode selection into explicit record IDs',

    toolDescription:
      'For a model whose stored selection is filter-mode (e.g. "all records matching these filters"), ' +
      'run the same filters through DataLayer and rewrite the selection as an explicit list of IDs. ' +
      'After materializing, individual IDs can be pruned with remove_from_selection.',

    toolInputSchema: {
      model: z.string().describe('Model whose selection should be materialized')
    },

    async handleToolCall(
      args: Record<string, unknown> = {},
      { selectionStore, dataLayer }: AppToolContext = {}
    ) {
      if (!selectionStore) return noSelectionStore()
      if (!dataLayer) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'DataLayer not available' }) }],
          isError: true
        }
      }

      const model = args.model as string
      const existing = selectionStore.get(model)
      if (!existing) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `No selection for ${model}` }) }],
          isError: true
        }
      }
      if (existing.mode !== 'filter') {
        return selectionToText(
          existing,
          `Selection for ${model} is already ids-mode (${existing.total} record(s)).`
        )
      }

      const perPage = Math.max(existing.total || 1, 1)
      const result = await dataLayer.searchNormalized(model, undefined, existing.filters, {
        page: 1,
        perPage
      })
      const ids = result.records
        .map((r) => (r as { id?: string | number }).id)
        .filter((id): id is string | number => id !== undefined)
        .map(String)

      const next = selectionStore.set({
        model,
        mode: 'ids',
        ids,
        total: ids.length,
        strategy: 'replace'
      })
      return selectionToText(
        next,
        `Materialized ${model} selection: ${ids.length} ID(s) now stored.`
      )
    }
  }

  // `modelClasses` is currently unused but threaded through so future
  // tools can validate model names against the live registry without
  // another factory parameter.
  void modelClasses

  return [
    getSelectionTool,
    addToSelectionTool,
    removeFromSelectionTool,
    clearSelectionTool,
    materializeSelectionTool
  ]
}
