/**
 * edit_model_app — MCP App tool for editing an existing record interactively.
 *
 * Renders a form generated from the FormClass (fields + fieldsets) and
 * ModelClass (attributes + associations). The form pre-fills with the
 * current record fetched by `record_id`; PromptClass is consulted only as a
 * fallback when no dataLayer is available.
 *
 * Association options (belongsTo selects, hasMany multiselects) are the ONLY
 * thing fetched from the API beyond the record itself, using the user's
 * access token at form-open time.
 *
 * The new and edit form apps share their iframe UI through
 * `src/mcp/apps/shared/model-form/main.js`; each app builds its own bundle
 * (`new-model-app.html` / `edit-model-app.html`) but the rendered DOM is the
 * same.
 */

import fs from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { generateFormSchema } from '#src/mcp/apps/lib/form-schema.js'
import { errorMeta } from '#src/mcp/apps/lib/helpers.js'
import * as logger from '#src/runtime/logger.js'

import type { FormSubmitMode } from '../../extensions/tool-flow.js'
import {
  buildDefaultsFromModel,
  filterEmpty,
  resolveAssociationOptions
} from '../lib/form-app-helpers.js'
import type { AppModelClass, DataLayer, ToolResult } from '../lib/types.js'

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist')
const HTML_PATH = path.join(DIST_DIR, 'edit-model-app.html')

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
    resourceUri: `ui://${namespace}/edit-model-app`,
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
