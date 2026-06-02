/**
 * Generic Model Form MCP Apps
 *
 * Creates two MCP App tools -- `new_model_app` and `edit_model_app` --
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

import {
  buildAssociationInstructions,
  resolveFormAssociations
} from '#src/mcp/apps/lib/form-associations.js'
import { generateFormSchema } from '#src/mcp/apps/lib/form-schema.js'
import { errorMeta } from '#src/mcp/apps/lib/helpers.js'
import { normalizeListWithConvention } from '#src/mcp/services/model-service.js'
import * as logger from '#src/services/logger.js'

import type { FormSubmitMode } from '../../extensions/tool-flow.js'
import type { AppModelClass, DataLayer, FormFieldDefinition, ToolResult } from '../lib/types.js'

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist')
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
  formClasses: Record<
    string,
    {
      fields?: string[]
      fieldsets?: Record<string, unknown>
      associations?: Array<string | Record<string, unknown>>
      [key: string]: unknown
    }
  >
  promptClasses?: Record<
    string,
    {
      new (args: Record<string, unknown>): { getDefaultFormState(): Record<string, unknown> }
      [key: string]: unknown
    }
  >
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
  handleToolCall(
    args: Record<string, unknown>,
    context: { dataLayer?: DataLayer; formSubmitMode?: FormSubmitMode }
  ): Promise<ToolResult>
  getHtml: () => string
}

/** Create the new_model_app MCP App. */
export function createNewModelApp({
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
    toolName: 'new_model_app',
    needsAuth: true,
    name: 'New Record',
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

    async handleToolCall(
      args: Record<string, unknown> = {},
      {
        dataLayer,
        formSubmitMode = 'direct'
      }: {
        dataLayer?: DataLayer
        formSubmitMode?: FormSubmitMode
      } = {}
    ) {
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
      const prefillArgs: Record<string, unknown> = {
        ...extraArgs,
        ...(prefill as Record<string, unknown>)
      }

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

      if (dataLayer) {
        await resolveAssociationOptions(schema.fields, dataLayer, defaults)
      }

      // Separate prefill args into rendered fields (defaults) and non-rendered (hiddenValues)
      const renderedFieldNames = new Set(schema.fields.map((f) => f.name))
      const hiddenValues: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(prefillArgs)) {
        if (!renderedFieldNames.has(key) && val !== undefined && val !== '' && val !== null) {
          hiddenValues[key] = val
        }
      }

      // Resolve a parent-context banner when the model is nested and we
      // know the parent id. The parent typically has no form of its own
      // (e.g. `domain` is the parent of `subdomain` but isn't authored
      // through this form factory), so we pass the full modelClasses map —
      // not the eligible subset.
      const parentContext = await resolveParentContext(
        ModelClass,
        modelClasses,
        hiddenValues,
        defaults,
        dataLayer
      )

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              defaults,
              mode: 'create',
              submitMode: formSubmitMode,
              ...(Object.keys(hiddenValues).length > 0 && { hiddenValues }),
              ...(parentContext && { parentContext })
            })
          }
        ]
      }
    },

    getHtml
  }
}

/** Create the edit_model_app MCP App. */
export function createEditModelApp({
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
    toolName: 'edit_model_app',
    needsAuth: true,
    name: 'Edit Record',
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

    async handleToolCall(
      args: Record<string, unknown> = {},
      {
        dataLayer,
        formSubmitMode = 'direct'
      }: {
        dataLayer?: DataLayer
        formSubmitMode?: FormSubmitMode
      } = {}
    ) {
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
      if (record_id && dataLayer) {
        defaults = await fetchRecord(dataLayer, ModelClass.api.endpoint, record_id as string)
      } else if (PromptClass) {
        defaults = new PromptClass(prefillArgs).getDefaultFormState()
        Object.assign(defaults, filterEmpty(prefillArgs))
      } else {
        defaults = buildDefaultsFromModel(ModelClass, FormClass)
        Object.assign(defaults, filterEmpty(prefillArgs))
      }

      if (dataLayer) {
        await resolveAssociationOptions(schema.fields, dataLayer, defaults)
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              schema,
              defaults,
              mode: 'update',
              submitMode: formSubmitMode,
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
  dataLayer: DataLayer,
  endpoint: string,
  recordId: string
): Promise<Record<string, unknown>> {
  try {
    const data = await dataLayer.dispatch('GET', `${endpoint}/${recordId}`)
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
 * When the form is for a nested model (e.g. `subdomain` under `domains/`),
 * resolve the parent record so the client can render a context banner
 * (`"Adding subdomain to Software Engineering"`). Returns `null` when
 * the model is standalone, the parent id isn't known, or fetching fails —
 * the banner is a UX nicety, not a hard requirement.
 */
async function resolveParentContext(
  ModelClass: AppModelClass,
  allModelClasses: Record<string, AppModelClass>,
  hiddenValues: Record<string, unknown>,
  defaults: Record<string, unknown>,
  dataLayer?: DataLayer
): Promise<{ parentModel: string; parentId: string; label: string } | null> {
  if (!dataLayer) return null
  const parent = ModelClass.api.parent
  if (!parent) return null
  const parentNames = Array.isArray(parent) ? parent : [parent]
  for (const parentName of parentNames) {
    const parentIdKey = `${parentName}_id`
    const parentIdRaw = hiddenValues[parentIdKey] ?? defaults[parentIdKey]
    if (parentIdRaw === undefined || parentIdRaw === null || parentIdRaw === '') continue
    const parentClass = allModelClasses[parentName]
    if (!parentClass) continue
    try {
      const data = await dataLayer.dispatch(
        'GET',
        `${parentClass.api.endpoint}/${String(parentIdRaw)}`
      )
      const record = (data.data as Record<string, unknown>) || data
      const labelField = ['name', 'title', 'slug'].find(
        (f) => typeof record[f] === 'string' && (record[f] as string).length > 0
      )
      const label =
        labelField !== undefined ? String(record[labelField]) : `${parentName} #${parentIdRaw}`
      return {
        parentModel: parentName,
        parentId: String(parentIdRaw),
        label
      }
    } catch (err) {
      logger.warn('Failed to resolve parent context for form', {
        service: 'mcp-app',
        parentModel: parentName,
        parentId: String(parentIdRaw),
        ...errorMeta(err)
      })
    }
  }
  return null
}

/**
 * Fetch association options from the API for fields that declare associations.
 * Mutates the fields array in place, adding `options` to association fields.
 */
async function resolveAssociationOptions(
  fields: FormFieldDefinition[],
  dataLayer: DataLayer,
  defaults: Record<string, unknown> = {}
): Promise<void> {
  const associationFields = fields.filter((f) => f.association)
  if (associationFields.length === 0) return

  const fetches = associationFields.map(async (field) => {
    try {
      let endpoint = field.association!.endpoint

      // Handle nested associations (e.g., categories under themes)
      if (field.association!.nested) {
        const { parentModel, childEndpoint } = field.association!.nested
        const parentValue = defaults[`${parentModel}_id`]
        if (!parentValue) {
          field.options = []
          return
        }
        const parentModelEndpoint = field.association!.endpoint
        endpoint = `${parentModelEndpoint}/${String(parentValue)}/${childEndpoint}`
      }

      const data = await dataLayer.dispatch('GET', endpoint)
      const { records } = normalizeListWithConvention(data, field.association!.convention, {
        page: 1,
        perPage: 200
      })

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
