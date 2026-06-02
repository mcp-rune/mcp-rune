/**
 * new_model_app — MCP App tool for creating a new record interactively.
 *
 * Renders a form generated from the FormClass (fields + fieldsets) and
 * ModelClass (attributes + associations). PromptClass is optional -- used
 * only for default values when available.
 *
 * Association options (belongsTo selects, hasMany multiselects) are the ONLY
 * thing fetched from the API, using the user's access token at form-open time.
 *
 * The new and edit form apps share their iframe UI through
 * `src/mcp/apps/shared/model-form/main.js`; each app builds its own bundle
 * (`new-model-app.html` / `edit-model-app.html`) but the rendered DOM is the
 * same.
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
import * as logger from '#src/services/logger.js'

import type { FormSubmitMode } from '../../extensions/tool-flow.js'
import {
  buildDefaultsFromModel,
  filterEmpty,
  resolveAssociationOptions
} from '../lib/form-app-helpers.js'
import type { AppModelClass, DataLayer, ToolResult } from '../lib/types.js'

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist')
const HTML_PATH = path.join(DIST_DIR, 'new-model-app.html')

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
    resourceUri: `ui://${namespace}/new-model-app`,
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
