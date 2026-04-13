/**
 * Shared selection tool factory for MCP Apps.
 *
 * Creates per-app `select_*_records` tools (bound to resourceUri) and a
 * `get_selection` tool (shared across all apps, read by the LLM).
 *
 * The ext-apps host enforces that app-initiated tool calls can only target tools
 * registered with the same resourceUri. Each app therefore needs its own select
 * tool. `get_selection` is returned by every factory call, but AppRegistry's
 * Map deduplicates by toolName — only the last one is kept.
 */

import { z } from 'zod'

/**
 * Create selection tools for an MCP App.
 *
 * @param {string} selectToolName - Unique tool name for this app's select tool
 * @param {string} resourceUri - The app's resourceUri (for ext-apps binding)
 * @param {string[]} modelNames - Available model names for the enum
 * @param {Object} options
 * @param {Function} options.getHtml - HTML getter for the app resource
 * @returns {Object[]} Array of tool definitions to spread into the app's return array
 */
export function createSelectionTools(selectToolName, resourceUri, modelNames, { getHtml }) {
  const selectTool = {
    resourceUri,
    toolName: selectToolName,
    needsAuth: false,
    visibility: ['app'],
    name: 'Record Selection',
    description: 'Store record selection server-side',

    toolDescription:
      'Save the current record selection (specific IDs or filter-based) for use in follow-up tool calls.',

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
      total: z.number().describe('Total number of selected records').optional()
    },

    async handleToolCall(args = {}, { selectionStore } = {}) {
      if (!selectionStore) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Selection store not available' }) }
          ]
        }
      }

      const selection = selectionStore.set(args)
      const total = selection.total || (selection.ids ? selection.ids.length : 0)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              selection,
              message: `User selected ${total} ${selection.model} record(s). Confirm the selection is saved and let them know what they can do with it.`
            })
          }
        ]
      }
    },

    getHtml
  }

  const getSelectionTool = {
    toolName: 'get_selection',
    needsAuth: false,
    visibility: ['model'],
    name: 'Record Selection',
    description: 'Retrieve stored record selections',

    toolDescription:
      'Retrieve record IDs from a stored selection. ' +
      'IMPORTANT: Call this FIRST whenever the user mentions "selected" records, ' +
      '"those records", or references records they previously picked — ' +
      'it returns the IDs needed for bulk_action_models. ' +
      "Pass a model name to get that model's selection, or omit to get all.",

    toolInputSchema: {
      model: z
        .string()
        .describe('Model name to get selection for. Omit to get all selections.')
        .optional()
    },

    async handleToolCall(args = {}, { selectionStore } = {}) {
      if (!selectionStore) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Selection store not available' }) }
          ]
        }
      }

      if (args.model) {
        const selection = selectionStore.get(args.model)
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

  return [selectTool, getSelectionTool]
}
