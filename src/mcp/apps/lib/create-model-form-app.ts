/**
 * Consolidated factory for the new_model_app and edit_model_app MCP Apps.
 *
 * The two apps share ~70% of their setup: eligibility filter, schema
 * generation, defaults composition, association-options resolution, and
 * the iframe HTML bundle (src/mcp/apps/shared/model-form/main.js). This
 * factory parameterizes the diverging concerns by mode:
 *
 *   create  — `new_model_app` tool; requires mode: "form" arg; runs the
 *             association pre-check; computes hiddenValues + parentContext;
 *             schema title is "Create <Endpoint>".
 *
 *   update  — `edit_model_app` tool; requires record_id; pre-fills from
 *             the fetched record; skips the association pre-check;
 *             schema title is "Edit <Singular>".
 */

import { z } from 'zod'

import {
  buildAssociationInstructions,
  resolveFormAssociations
} from '#src/mcp/apps/lib/app-form-associations.js'
import { generateAppFormSchema } from '#src/mcp/apps/lib/app-form-schema.js'
import { errorMeta, humanize } from '#src/mcp/apps/lib/helpers.js'
import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'
import type { ToolResult } from '#src/mcp/tools/tool-result.js'
import * as logger from '#src/runtime/logger.js'

import type { FormSubmitMode } from '../../extensions/tool-flow.js'
import type { AppFormClass } from './app-form-entities.js'
import {
  buildDefaultsFromModel,
  filterEmpty,
  resolveAssociationOptions
} from './app-form-helpers.js'
import type { AppModelClass } from './app-shared-entities.js'
import { bindAppForm } from './bind-app-form.js'
import { createHtmlLoader } from './html-loader.js'
import type { AppDefinition } from './registry.js'

interface PromptClassLike {
  new (args: Record<string, unknown>): { getDefaultFormState(): Record<string, unknown> }
  [key: string]: unknown
}

export interface CreateModelFormAppOptions {
  mode: 'create' | 'update'
  modelClasses: Record<string, AppModelClass>
  formClasses: Record<string, AppFormClass>
  promptClasses?: Record<string, PromptClassLike>
  namespace: string
}

interface BuildContext {
  modelClasses: Record<string, AppModelClass>
  eligible: Record<string, AppModelClass>
  modelNames: [string, ...string[]]
  formClasses: Record<string, AppFormClass>
  promptClasses: Record<string, PromptClassLike>
  namespace: string
}

const getNewAppHtml = createHtmlLoader('new-model-app')
const getEditAppHtml = createHtmlLoader('edit-model-app')

export function createModelFormApp(options: CreateModelFormAppOptions): AppDefinition {
  const { mode, modelClasses, formClasses, promptClasses = {}, namespace } = options

  const eligible = Object.fromEntries(
    Object.entries(modelClasses).filter(([name]) => name in formClasses)
  )
  const modelNames = Object.keys(eligible) as [string, ...string[]]

  const ctx: BuildContext = {
    modelClasses,
    eligible,
    modelNames,
    formClasses,
    promptClasses,
    namespace
  }

  return mode === 'create' ? buildCreateApp(ctx) : buildUpdateApp(ctx)
}

function buildCreateApp(ctx: BuildContext): AppDefinition {
  const { modelClasses, eligible, modelNames, formClasses, promptClasses, namespace } = ctx

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
      context: Record<string, unknown> = {}
    ): Promise<ToolResult> {
      const dataLayer = context.dataLayer as DataLayer | undefined
      const formSubmitMode = (context.formSubmitMode as FormSubmitMode | undefined) ?? 'direct'

      const { model, mode: openMode, prefill, ...extraArgs } = args

      if (openMode !== 'form') {
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

      const boundForm = bindAppForm(FormClass, ModelClass)

      if (boundForm.associations.length > 0) {
        const { unresolved, hasUnresolvedRequired } = resolveFormAssociations(
          boundForm,
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

      const schema = generateAppFormSchema(boundForm, { allModelClasses: eligible })
      schema.title = `Create ${humanize(ModelClass.api.endpoint)}`

      const defaults: Record<string, unknown> = PromptClass
        ? new PromptClass(prefillArgs).getDefaultFormState()
        : buildDefaultsFromModel(ModelClass, FormClass)
      Object.assign(defaults, filterEmpty(prefillArgs))

      if (dataLayer) {
        await resolveAssociationOptions(schema.fields, dataLayer, defaults)
      }

      const renderedFieldNames = new Set(schema.fields.map((f) => f.name))
      const hiddenValues: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(prefillArgs)) {
        if (!renderedFieldNames.has(key) && val !== undefined && val !== '' && val !== null) {
          hiddenValues[key] = val
        }
      }

      // Parent context uses the full modelClasses map: the parent often has
      // no form of its own (e.g. `domain` parents `subdomain` but isn't
      // authored through this factory).
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

    getHtml: getNewAppHtml
  }
}

function buildUpdateApp(ctx: BuildContext): AppDefinition {
  const { eligible, modelNames, formClasses, promptClasses, namespace } = ctx

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
      context: Record<string, unknown> = {}
    ): Promise<ToolResult> {
      const dataLayer = context.dataLayer as DataLayer | undefined
      const formSubmitMode = (context.formSubmitMode as FormSubmitMode | undefined) ?? 'direct'

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

      const boundForm = bindAppForm(FormClass, ModelClass)
      const schema = generateAppFormSchema(boundForm, { allModelClasses: eligible })
      schema.title = `Edit ${humanize(ModelClass.singularName)}`

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

    getHtml: getEditAppHtml
  }
}

/**
 * When the form is for a nested model (e.g. `subdomain` under `domains/`),
 * resolve the parent record so the client can render a context banner
 * (`"Adding subdomain to Software Engineering"`). Returns `null` when the
 * model is standalone, the parent id isn't known, or fetching fails — the
 * banner is a UX nicety, not a hard requirement.
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
