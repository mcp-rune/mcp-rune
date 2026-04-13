/**
 * Form data tools for MCP Apps.
 *
 * Creates a `collect_form_data` tool (called by the form client) and a
 * `get_form_data` tool (called by the LLM to retrieve collected data).
 *
 * This follows the same pattern as selection-tools.js:
 *   - collect_form_data is app-only (client stores data)
 *   - get_form_data is model-only (LLM retrieves data)
 *
 * The form never calls create_model directly. Instead:
 *   1. Form collects scalar fields → calls collect_form_data
 *   2. LLM calls get_form_data → merges with prerequisites
 *   3. LLM validates full payload → presents review → submits
 */

import { z } from 'zod'

/**
 * Create form data tools for the model-form MCP App.
 *
 * @param {string} resourceUri - The model-form app's resourceUri
 * @param {string[]} modelNames - Available model names for the enum
 * @param {Object} options
 * @param {Function} options.getHtml - HTML getter for the app resource
 * @returns {Object[]} Array of tool definitions
 */
export function createFormDataTools(resourceUri, modelNames, { getHtml }) {
  const collectTool = {
    resourceUri,
    toolName: 'collect_form_data',
    needsAuth: false,
    visibility: ['app'],
    name: 'Collect Form Data',
    description: 'Store form data collected by the interactive form',

    toolDescription:
      'Save form field values collected by the interactive form UI. ' +
      'Called by the form client when the user clicks Done.',

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model the form was editing'),
      fields: z.record(z.string(), z.unknown()).describe('Collected form field values'),
      mode: z.enum(['create', 'update']).optional().describe('Form mode: create or update')
    },

    async handleToolCall(args = {}, { formDataStore } = {}) {
      if (!formDataStore) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Form data store not available' }) }
          ]
        }
      }

      const entry = formDataStore.set(args)
      const fieldCount = Object.keys(entry.fields).length
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              entry,
              message:
                `Form data collected for ${entry.model} (${fieldCount} field${fieldCount !== 1 ? 's' : ''}). ` +
                `Review the data, merge with any pre-selected associations, validate, and confirm with the user before submitting.`
            })
          }
        ]
      }
    },

    getHtml
  }

  const getFormDataTool = {
    toolName: 'get_form_data',
    needsAuth: false,
    visibility: ['model'],
    name: 'Get Form Data',
    description: 'Retrieve form data collected by the interactive form',

    toolDescription:
      'Retrieve field values collected by the interactive form. ' +
      "Call this after the form signals completion to get the user's input. " +
      'Then merge with any pre-selected associations (from get_selection), ' +
      'validate the full payload, present a review summary, and submit on confirmation.',

    toolInputSchema: {
      model: z
        .string()
        .describe('Model name to get form data for. Omit to get all collected data.')
        .optional()
    },

    async handleToolCall(args = {}, { formDataStore } = {}) {
      if (!formDataStore) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Form data store not available' }) }
          ]
        }
      }

      if (args.model) {
        const entry = formDataStore.get(args.model)
        if (!entry) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  entry: null,
                  message: `No form data collected for ${args.model}`
                })
              }
            ]
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ entry }) }]
        }
      }

      const entries = formDataStore.getAll()
      const count = Object.keys(entries).length
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              entries,
              count,
              message: count === 0 ? 'No form data collected' : `${count} form(s) collected`
            })
          }
        ]
      }
    }
  }

  return [collectTool, getFormDataTool]
}
