/**
 * Generic Model Form MCP Apps
 *
 * Creates two MCP App tools — `create_model_form` and `update_model_form` —
 * that accept a `model` parameter, analogous to `create_model`/`update_model`.
 *
 * The form schema is generated from the FormClass (fields + fieldsets) and
 * ModelClass (attributes + associations). PromptClass is optional — used
 * only for default values when available.
 *
 * Association options (belongsTo selects, hasMany multiselects) are the ONLY thing
 * fetched from the API, using the user's access token at form-open time.
 *
 * Build: npm run build:engineer:apps
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { generateFormSchema } from '#lib/mcp/apps/form-schema.js'
import {
  resolveFormAssociations,
  buildAssociationInstructions
} from '#lib/mcp/apps/form-associations.js'
import * as logger from '#lib/services/logger.js'
import { errorMeta } from '#lib/mcp/apps/helpers.js'
import { defaultConvention } from '#lib/mcp/api-conventions/index.js'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'model-form.html')

let _cachedHtml = null

function getHtml() {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

/**
 * Create the create_model_form MCP App.
 *
 * @param {Object} options
 * @param {Object} options.modelClasses - Map of model name → ModelClass
 * @param {Object} options.formClasses - Map of model name → FormClass
 * @param {Object} [options.promptClasses] - Map of model name → PromptClass (for defaults)
 * @returns {Object} App definition for AppRegistry
 */
export function createCreateFormApp({ modelClasses, formClasses, promptClasses = {}, namespace }) {
  // Convention: only models with a form class are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([name]) => name in formClasses)
  )
  const modelNames = Object.keys(eligible)

  return {
    resourceUri: `ui://${namespace}/model-form`,
    toolName: 'create_model_form',
    needsAuth: true,
    name: 'Create Model Form',
    description: 'Interactive form for creating a new record',

    toolDescription:
      `Open an interactive form for creating a new record. ` +
      `Requires mode: "form" — do NOT call without it. ` +
      `If the user asks to create a record, call get_prompt_guide first to present creation mode options.\n` +
      `For models with associations, use specialized tools BEFORE opening the form, ` +
      `then pass selected values via prefill.\n` +
      `Available models: ${modelNames.join(', ')}.`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to create'),
      mode: z
        .enum(['form'])
        .optional()
        .describe(
          'Set to "form" to open the interactive form. If omitted, returns creation mode options for the user to choose.'
        ),
      prefill: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Pre-filled values for association fields (e.g., { platform_link: "...", content_id: "123" })'
        )
    },

    async handleToolCall(args = {}, { apiClient } = {}) {
      const { model, mode, prefill, ...extraArgs } = args

      if (mode !== 'form') {
        return {
          content: [
            {
              type: 'text',
              text:
                'Do not call this tool without mode: "form". ' +
                'To start a creation workflow, call get_prompt_guide with the appropriate guide_name. ' +
                'That tool will present the user with creation mode options (Interactive Form, Guided, Quick).'
            }
          ],
          isError: true
        }
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

      const ModelClass = eligible[model]
      const FormClass = formClasses[model]
      const PromptClass = promptClasses[model]
      const prefillArgs = { ...extraArgs, ...prefill }

      // Check form associations before rendering
      if (FormClass?.associations?.length > 0) {
        const { unresolved, hasUnresolvedRequired } = resolveFormAssociations(
          FormClass.associations,
          ModelClass,
          prefillArgs
        )

        if (hasUnresolvedRequired) {
          const instructions = buildAssociationInstructions(unresolved)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'associations_needed',
                  model,
                  associations: instructions,
                  message:
                    'Resolve required associations before opening the form. Optional associations can be skipped.'
                })
              }
            ]
          }
        }
      }

      const schema = generateFormSchema(ModelClass, FormClass, { allModelClasses: eligible })

      const defaults = PromptClass
        ? new PromptClass(prefillArgs).getDefaultFormState()
        : buildDefaultsFromModel(ModelClass, FormClass)
      Object.assign(defaults, filterEmpty(prefillArgs))

      if (apiClient) {
        await resolveAssociationOptions(schema.fields, apiClient, defaults)
      }

      // Separate prefill args into rendered fields (defaults) and non-rendered (hiddenValues)
      const renderedFieldNames = new Set(schema.fields.map((f) => f.name))
      const hiddenValues = {}
      for (const [key, val] of Object.entries(prefillArgs)) {
        if (!renderedFieldNames.has(key) && val !== undefined && val !== '' && val !== null) {
          hiddenValues[key] = val
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              defaults,
              mode: 'create',
              ...(Object.keys(hiddenValues).length > 0 && { hiddenValues })
            })
          }
        ]
      }
    },

    getHtml
  }
}

/**
 * Create the update_model_form MCP App.
 *
 * @param {Object} options
 * @param {Object} options.modelClasses - Map of model name → ModelClass
 * @param {Object} options.formClasses - Map of model name → FormClass
 * @param {Object} [options.promptClasses] - Map of model name → PromptClass (for defaults)
 * @returns {Object} App definition for AppRegistry
 */
export function createUpdateFormApp({ modelClasses, formClasses, promptClasses = {}, namespace }) {
  // Convention: only models with a form class are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([name]) => name in formClasses)
  )
  const modelNames = Object.keys(eligible)

  return {
    resourceUri: `ui://${namespace}/model-form`,
    toolName: 'update_model_form',
    needsAuth: true,
    name: 'Edit Model Form',
    description: 'Interactive form for editing an existing record',

    toolDescription:
      `Show an interactive form for editing an existing record. ` +
      `The form pre-fills with current values and submits changes via update_model. ` +
      `Use this when the user wants to edit a record interactively. ` +
      `Available models: ${modelNames.join(', ')}.`,

    toolInputSchema: {
      model: z.enum(modelNames).describe('Model to edit'),
      record_id: z.string().describe('ID of the record to edit')
    },

    async handleToolCall(args = {}, { apiClient } = {}) {
      const { model, record_id, ...prefillArgs } = args

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
      const FormClass = formClasses[model]
      const PromptClass = promptClasses[model]

      const schema = generateFormSchema(ModelClass, FormClass, { allModelClasses: eligible })

      let defaults
      if (record_id && apiClient) {
        defaults = await fetchRecord(apiClient, ModelClass.endpoint, record_id)
      } else if (PromptClass) {
        defaults = new PromptClass(prefillArgs).getDefaultFormState()
        Object.assign(defaults, filterEmpty(prefillArgs))
      } else {
        defaults = buildDefaultsFromModel(ModelClass, FormClass)
        Object.assign(defaults, filterEmpty(prefillArgs))
      }

      if (apiClient) {
        await resolveAssociationOptions(schema.fields, apiClient, defaults)
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              defaults,
              mode: 'update',
              ...(record_id && { recordId: record_id })
            })
          }
        ]
      }
    },

    getHtml
  }
}

/**
 * Fetch a single record from the API for pre-filling the update form.
 *
 * @param {Object} apiClient - API client with get method
 * @param {string} endpoint - Model endpoint (e.g., 'books')
 * @param {string} recordId - Record ID to fetch
 * @returns {Object} Record data or empty object on failure
 */
async function fetchRecord(apiClient, endpoint, recordId) {
  try {
    const data = await apiClient.get(`${endpoint}/${recordId}`)
    return data.data || data
  } catch (err) {
    logger.warn('Failed to fetch record for form', {
      service: 'mcp-app',
      model: endpoint,
      recordId,
      ...errorMeta(err)
    })
    return {}
  }
}

/**
 * Fetch association options from the API for fields that declare associations.
 * Mutates the fields array in place, adding `options` to association fields.
 *
 * @param {Object[]} fields - Field definitions from generateFormSchema
 * @param {Object} apiClient - API client with get/post methods
 * @param {Object} [defaults] - Default values (record data) for nested path interpolation
 */
async function resolveAssociationOptions(fields, apiClient, defaults = {}) {
  const associationFields = fields.filter((f) => f.association)
  if (associationFields.length === 0) return

  const fetches = associationFields.map(async (field) => {
    try {
      let endpoint = field.association.endpoint

      // Handle nested associations (e.g., categories under themes)
      if (field.association.nested) {
        const { pathTemplate, parentKey } = field.association.nested
        const parentValue = defaults[parentKey]
        if (!parentValue) {
          field.options = []
          return
        }
        endpoint = pathTemplate.replace(`:${parentKey}`, parentValue)
      }

      const data = await apiClient.get(endpoint)
      const convention = field.association.convention ?? defaultConvention
      const { records } = convention.normalizeListResponse(data, { page: 1, perPage: 200 })

      const valueField = field.association.valueField || 'id'
      field.options = records.map((record) => ({
        value: record[valueField] || record.id,
        label: record[field.association.labelField] || record.name || `ID: ${record.id}`,
        ...(record.color && { color: record.color })
      }))
    } catch (err) {
      logger.warn('Failed to resolve association options', {
        service: 'mcp-app',
        field: field.name,
        endpoint: field.association.endpoint,
        ...errorMeta(err)
      })
      // If API call fails, leave as empty select — form still renders
      field.options = []
    }
  })

  await Promise.all(fetches)
}

/**
 * Build default values from model attributes for fields in the form.
 * Used when no PromptClass is available.
 *
 * @param {Object} ModelClass - Model class with static attributes
 * @param {Object} FormClass - Form class with static fields
 * @returns {Object} Default values
 */
function buildDefaultsFromModel(ModelClass, FormClass) {
  const defaults = {}
  const fieldNames = FormClass?.fields || []
  for (const name of fieldNames) {
    const attr = ModelClass.attributes[name]
    if (attr?.default !== undefined) {
      defaults[name] = attr.default
    }
  }
  return defaults
}

/**
 * Filter out null/undefined/empty-string values from an object
 * @param {Object} obj
 * @returns {Object}
 */
function filterEmpty(obj) {
  const result = {}
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && val !== undefined && val !== '') {
      result[key] = val
    }
  }
  return result
}
