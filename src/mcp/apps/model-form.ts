/**
 * Generic Model Form MCP Apps
 *
 * Creates two MCP App tools -- `create_model_form` and `update_model_form` --
 * that accept a `model` parameter, analogous to `create_model`/`update_model`.
 *
 * The form schema is generated from the FormClass (fields + fieldsets) and
 * ModelClass (attributes + associations). PromptClass is optional -- used
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
import { generateFormSchema } from '#src/mcp/apps/form-schema.js'
import {
  resolveFormAssociations,
  buildAssociationInstructions
} from '#src/mcp/apps/form-associations.js'
import * as logger from '#src/services/logger.js'
import { errorMeta } from '#src/mcp/apps/helpers.js'
import { defaultConvention } from '#src/mcp/api-conventions/index.js'
import type { AppModelClass, FormFieldDefinition, ToolResult, ApiClient } from './types.js'

const DIST_DIR = path.resolve(import.meta.dirname, 'dist')
const HTML_PATH = path.join(DIST_DIR, 'model-form.html')

let _cachedHtml: string | null = null

function getHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = fs.readFileSync(HTML_PATH, 'utf-8')
  }
  return _cachedHtml
}

interface FormAppOptions {
  modelClasses: Record<string, AppModelClass>
  formClasses: Record<string, { fields?: string[]; fieldsets?: Record<string, unknown>; associations?: Array<string | Record<string, unknown>>; [key: string]: unknown }>
  promptClasses?: Record<string, { new (args: Record<string, unknown>): { getDefaultFormState(): Record<string, unknown> }; [key: string]: unknown }>
  namespace: string
}

interface AppDefinition {
  resourceUri: string
  toolName: string
  needsAuth: boolean
  name: string
  description: string
  toolDescription: string
  toolInputSchema: Record<string, z.ZodTypeAny>
  handleToolCall(args: Record<string, unknown>, context: { apiClient?: ApiClient }): Promise<ToolResult>
  getHtml: () => string
}

/** Create the create_model_form MCP App. */
export function createCreateFormApp({
  modelClasses,
  formClasses,
  promptClasses = {},
  namespace
}: FormAppOptions): AppDefinition {
  // Convention: only models with a form class are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([name]) => name in formClasses)
  )
  const modelNames = Object.keys(eligible) as [string, ...string[]]

  return {
    resourceUri: `ui://${namespace}/model-form`,
    toolName: 'create_model_form',
    needsAuth: true,
    name: 'Create Model Form',
    description: 'Interactive form for creating a new record',

    toolDescription:
      `Open an interactive form for creating a new record. ` +
      `Requires mode: "form" -- do NOT call without it. ` +
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

    async handleToolCall(args: Record<string, unknown> = {}, { apiClient } = {}) {
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

      if (!model || !eligible[model as string]) {
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

      const ModelClass = eligible[model as string]!
      const FormClass = formClasses[model as string]!
      const PromptClass = promptClasses[model as string]
      const prefillArgs: Record<string, unknown> = { ...extraArgs, ...(prefill as Record<string, unknown>) }

      // Check form associations before rendering
      if (FormClass?.associations && FormClass.associations.length > 0) {
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

      const defaults: Record<string, unknown> = PromptClass
        ? new PromptClass(prefillArgs).getDefaultFormState()
        : buildDefaultsFromModel(ModelClass, FormClass)
      Object.assign(defaults, filterEmpty(prefillArgs))

      if (apiClient) {
        await resolveAssociationOptions(schema.fields, apiClient, defaults)
      }

      // Separate prefill args into rendered fields (defaults) and non-rendered (hiddenValues)
      const renderedFieldNames = new Set(schema.fields.map((f) => f.name))
      const hiddenValues: Record<string, unknown> = {}
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

/** Create the update_model_form MCP App. */
export function createUpdateFormApp({
  modelClasses,
  formClasses,
  promptClasses = {},
  namespace
}: FormAppOptions): AppDefinition {
  // Convention: only models with a form class are eligible
  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([name]) => name in formClasses)
  )
  const modelNames = Object.keys(eligible) as [string, ...string[]]

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

    async handleToolCall(args: Record<string, unknown> = {}, { apiClient } = {}) {
      const { model, record_id, ...prefillArgs } = args

      if (!model || !eligible[model as string]) {
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

      const ModelClass = eligible[model as string]!
      const FormClass = formClasses[model as string]!
      const PromptClass = promptClasses[model as string]

      const schema = generateFormSchema(ModelClass, FormClass, { allModelClasses: eligible })

      let defaults: Record<string, unknown>
      if (record_id && apiClient) {
        defaults = await fetchRecord(apiClient, ModelClass.endpoint, record_id as string)
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
              ...(record_id ? { recordId: record_id } : {})
            })
          }
        ]
      }
    },

    getHtml
  }
}

/** Fetch a single record from the API for pre-filling the update form. */
async function fetchRecord(
  apiClient: ApiClient,
  endpoint: string,
  recordId: string
): Promise<Record<string, unknown>> {
  try {
    const data = await apiClient.get(`${endpoint}/${recordId}`)
    return (data.data as Record<string, unknown>) || data
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
 */
async function resolveAssociationOptions(
  fields: FormFieldDefinition[],
  apiClient: ApiClient,
  defaults: Record<string, unknown> = {}
): Promise<void> {
  const associationFields = fields.filter((f) => f.association)
  if (associationFields.length === 0) return

  const fetches = associationFields.map(async (field) => {
    try {
      let endpoint = field.association!.endpoint

      // Handle nested associations (e.g., categories under themes)
      if (field.association!.nested) {
        const { pathTemplate, parentKey } = field.association!.nested
        const parentValue = defaults[parentKey]
        if (!parentValue) {
          field.options = []
          return
        }
        endpoint = pathTemplate.replace(`:${parentKey}`, String(parentValue))
      }

      const data = await apiClient.get(endpoint)
      const convention = field.association!.convention ?? defaultConvention
      const { records } = convention.normalizeListResponse(data, { page: 1, perPage: 200 })

      const valueField = field.association!.valueField || 'id'
      field.options = records.map((record) => ({
        value: String(record[valueField] || record.id),
        label: String(record[field.association!.labelField] || record.name || `ID: ${record.id}`),
        ...(record.color ? { color: String(record.color) } : {})
      }))
    } catch (err) {
      logger.warn('Failed to resolve association options', {
        service: 'mcp-app',
        field: field.name,
        endpoint: field.association!.endpoint,
        ...errorMeta(err)
      })
      // If API call fails, leave as empty select -- form still renders
      field.options = []
    }
  })

  await Promise.all(fetches)
}

/**
 * Build default values from model attributes for fields in the form.
 * Used when no PromptClass is available.
 */
function buildDefaultsFromModel(
  ModelClass: AppModelClass,
  FormClass: { fields?: string[]; [key: string]: unknown }
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  const fieldNames = FormClass?.fields || []
  for (const name of fieldNames) {
    const attr = ModelClass.attributes[name]
    if (attr?.default !== undefined) {
      defaults[name] = attr.default
    }
  }
  return defaults
}

/** Filter out null/undefined/empty-string values from an object */
function filterEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && val !== undefined && val !== '') {
      result[key] = val
    }
  }
  return result
}
