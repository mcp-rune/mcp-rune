import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { storeOperation } from '#src/services/vector-storage.js'

import type { ModelConfig, ToolResult } from '../base-tool.js'
import { SaveModelBaseTool } from '../save-model-base-tool.js'

export const MAX_BATCH_SIZE = 25
const MAX_CONCURRENCY = 5

interface BulkResult {
  index: number
  id?: string
  status: string
  errors?: string[]
  status_code?: number
}

interface HttpError extends Error {
  response?: {
    status?: number
    data?: unknown
  }
}

/**
 * Tool for creating, updating, or deleting multiple records in a single tool call
 *
 * Replaces individual tool calls that hit Claude Desktop's per-turn tool-use limit.
 * Uses parallel execution with concurrency cap and partial failure handling.
 */
export class BulkActionModelsTool extends SaveModelBaseTool {
  override get name(): string {
    return 'bulk_action_models'
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return (
      `Create, update, or delete multiple records${scope} in a single call (max ${MAX_BATCH_SIZE}). ` +
      'PREFERRED when the user provides a spreadsheet, Excel file, CSV, or any tabular data — ' +
      "extract rows and use action='create' with records array. " +
      'When the user refers to "selected" records, call get_selection first to retrieve stored record_ids. ' +
      "Use action='update' with record_ids + attributes to apply the same change to many records. " +
      "Use action='delete' with record_ids to remove many records. " +
      'For nested-only models (e.g., renditions, schedulings), provide parent_resource ' +
      '(tool-level for shared parent, or per-record inside each record for different parents). ' +
      'Handles partial failures gracefully.'
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      model: this.zodEnum(this.getWritableModelNames()).describe(
        'Model name. All records must be the same model type.'
      ),
      action: z.enum(['create', 'update', 'delete']).describe('Action to perform on all records.'),
      records: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .max(MAX_BATCH_SIZE)
        .describe(
          'For create: array of attribute objects. For per-record update: array of objects each with record_id + attributes to change.'
        )
        .optional(),
      record_ids: z
        .array(z.string())
        .min(1)
        .max(MAX_BATCH_SIZE)
        .describe('For uniform update or delete: array of record IDs.')
        .optional(),
      attributes: z
        .record(z.string(), z.unknown())
        .describe('For uniform update: attributes to apply to all record_ids.')
        .optional(),
      parent_resource: z
        .string()
        .describe(
          "Parent resource path for nested model creation (e.g., 'assets/123/renditions'). " +
            'Required when bulk-creating nested-only models.'
        )
        .optional(),
      user_id: z.string().describe('User ID to impersonate (service accounts only).').optional(),
      plan_id: z
        .string()
        .describe('Plan ID from preview_mutation_plan for batch tracking in Changeset')
        .optional()
    }
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const { model, action, user_id, parent_resource } = args as {
        model: string
        action: 'create' | 'update' | 'delete'
        user_id?: string
        parent_resource?: string
      }

      this.validateModel(model)

      const modelConfig = this.getModelConfig(model)!

      if (modelConfig.api?.readOnly) {
        throw new Error(
          `The '${model}' model is read-only and cannot be modified. ` +
            `${modelConfig.description ? modelConfig.description + ' ' : ''}` +
            'Use find_model to look up existing records.'
        )
      }

      this._validateArgs(action, args)

      const options = user_id ? { userId: user_id } : {}
      let results: BulkResult[]

      switch (action) {
        case 'create':
          results = await this._executeCreate(
            modelConfig,
            model,
            args.records as Record<string, unknown>[],
            options,
            parent_resource
          )
          break
        case 'update':
          results = (args.record_ids as string[] | undefined)
            ? await this._executeUniformUpdate(
                modelConfig,
                model,
                args.record_ids as string[],
                args.attributes as Record<string, unknown>,
                options
              )
            : await this._executePerRecordUpdate(
                modelConfig,
                model,
                args.records as Record<string, unknown>[],
                options
              )
          break
        case 'delete':
          results = await this._executeDelete(
            modelConfig,
            model,
            args.record_ids as string[],
            options
          )
          break
      }

      const succeeded = results.filter((r) =>
        ['created', 'updated', 'deleted'].includes(r.status)
      ).length
      const failed = results.length - succeeded
      const summary = { total: results.length, succeeded, failed, action }

      if (this.logger) {
        this.logger.info('Bulk action completed', {
          service: 'mcp-tools',
          tool: 'bulk_action_models',
          model,
          total: summary.total,
          succeeded: summary.succeeded,
          failed: summary.failed,
          action: summary.action,
          impersonating: user_id ?? null
        })
      }

      storeOperation({
        toolName: 'bulk_action_models',
        toolArgs: { model, action, record_count: results.length },
        toolOutput: summary,
        userId: user_id,
        sessionId: (this.serverContext as Record<string, unknown>)?.sessionId as string | undefined
      }).catch((err: Error) => {
        if (this.logger) {
          this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
        }
      })

      const envelope = { summary, results }
      const response = this.formatResponse(envelope as unknown as Record<string, unknown>)

      // isError only when ALL records failed
      if (succeeded === 0) {
        ;(response as unknown as Record<string, unknown>).isError = true
      }

      return response
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  /** Validate args per action (imperative, not Zod refine -- keeps schema flat and LLM-friendly) */
  private _validateArgs(action: string, args: Record<string, unknown>): void {
    const records = args.records as Record<string, unknown>[] | undefined
    const record_ids = args.record_ids as string[] | undefined
    const attributes = args.attributes as Record<string, unknown> | undefined

    switch (action) {
      case 'create':
        if (!records || records.length === 0) {
          throw new Error("action 'create' requires 'records' array.")
        }
        if (args.parent_resource && records.some((r) => r.parent_resource)) {
          throw new Error(
            'Cannot combine tool-level parent_resource with per-record parent_resource. ' +
              'Use EITHER the parent_resource parameter (all records share one parent) ' +
              'OR parent_resource inside each record (each record specifies its own parent).'
          )
        }
        break
      case 'update':
        if (record_ids) {
          if (!attributes || Object.keys(attributes).length === 0) {
            throw new Error("Uniform update (record_ids) requires 'attributes'.")
          }
        } else if (records) {
          for (let i = 0; i < records.length; i++) {
            if (!records[i]!.record_id) {
              throw new Error(
                `Per-record update requires 'record_id' in each record (missing at index ${i}).`
              )
            }
          }
        } else {
          throw new Error(
            "action 'update' requires either 'record_ids' + 'attributes' or 'records' with 'record_id' per entry."
          )
        }
        break
      case 'delete':
        if (!record_ids || record_ids.length === 0) {
          throw new Error("action 'delete' requires 'record_ids' array.")
        }
        break
    }
  }

  /**
   * Prepare create: extract per-record parent_resource, resolve endpoints, validate required fields.
   */
  private _prepareCreate(
    modelConfig: ModelConfig,
    model: string,
    records: Record<string, unknown>[],
    parentResource: string | undefined
  ): {
    records: Record<string, unknown>[]
    endpoints: string[]
    results: BulkResult[]
    validIndices: number[]
  } {
    const nestedOnly = modelConfig.api?.nested?.nestedOnly
    const requiredFields = ((modelConfig as Record<string, unknown>).required as string[]) ?? []
    const results = new Array<BulkResult>(records.length)
    const endpoints = new Array<string>(records.length)
    const cleanRecords = new Array<Record<string, unknown>>(records.length)
    const validIndices: number[] = []

    for (let i = 0; i < records.length; i++) {
      const { parent_resource: recordParent, ...attrs } = records[i]!
      cleanRecords[i] = attrs

      // Resolve endpoint
      const effectiveParent = (recordParent as string | undefined) || parentResource
      if (effectiveParent) {
        endpoints[i] = effectiveParent
      } else if (nestedOnly) {
        const parentModels =
          ((modelConfig.api?.nested as Record<string, unknown>)?.parentModels as string[]) ?? []
        results[i] = {
          index: i,
          status: 'validation_error',
          errors: [
            `'${model}' is a nested-only model — provide parent_resource in the record ` +
              `(e.g., '${parentModels[0]}s/123/${modelConfig.endpoint}'). ` +
              `Valid parents: ${parentModels.join(', ')}.`
          ]
        }
        continue
      } else {
        endpoints[i] = modelConfig.endpoint
      }

      // Validate required fields
      const missing = requiredFields.filter((field) => attrs[field] === undefined)
      if (missing.length > 0) {
        results[i] = {
          index: i,
          status: 'validation_error',
          errors: [`Missing required fields: ${missing.join(', ')}`]
        }
        continue
      }

      validIndices.push(i)
    }

    return { records: cleanRecords, endpoints, results, validIndices }
  }

  /** Loosely-typed API client to allow server-specific extra args (e.g., userId impersonation) */
  private get _api(): Record<string, (...args: unknown[]) => Promise<unknown>> {
    return this.apiClient! as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  }

  /** Execute create: prepare records then run parallel API calls. */
  private async _executeCreate(
    modelConfig: ModelConfig,
    model: string,
    records: Record<string, unknown>[],
    options: Record<string, unknown>,
    parentResource: string | undefined
  ): Promise<BulkResult[]> {
    const {
      records: cleanRecords,
      endpoints,
      results,
      validIndices
    } = this._prepareCreate(modelConfig, model, records, parentResource)

    const tasks = validIndices.map(
      (i) => () =>
        this._api.post!(endpoints[i]!, this.buildRequestPayload(model, cleanRecords[i]!), options)
          .then((data) => {
            results[i] = {
              index: i,
              status: 'created',
              id: (data as Record<string, unknown>).id as string
            }
          })
          .catch((error: HttpError) => {
            results[i] = {
              index: i,
              status: 'api_error',
              errors: [this._extractErrorMessage(error)],
              ...(error.response?.status && { status_code: error.response.status })
            }
          })
    )

    await this._runParallel(tasks)
    return results
  }

  /** Uniform update: same attributes applied to all record_ids */
  private async _executeUniformUpdate(
    modelConfig: ModelConfig,
    model: string,
    recordIds: string[],
    attributes: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<BulkResult[]> {
    const results = new Array<BulkResult>(recordIds.length)

    const tasks = recordIds.map(
      (id, i) => () =>
        this._api.patch!(
          `${modelConfig.endpoint}/${id}`,
          this.buildRequestPayload(model, attributes),
          options
        )
          .then(() => {
            results[i] = { index: i, id, status: 'updated' }
          })
          .catch((error: HttpError) => {
            results[i] = {
              index: i,
              id,
              status: 'api_error',
              errors: [this._extractErrorMessage(error)],
              ...(error.response?.status && { status_code: error.response.status })
            }
          })
    )

    await this._runParallel(tasks)
    return results
  }

  /** Per-record update: each record has its own record_id and attributes */
  private async _executePerRecordUpdate(
    modelConfig: ModelConfig,
    model: string,
    records: Record<string, unknown>[],
    options: Record<string, unknown>
  ): Promise<BulkResult[]> {
    const results = new Array<BulkResult>(records.length)

    const tasks = records.map((record, i) => () => {
      const { record_id, ...attrs } = record
      return this._api.patch!(
        `${modelConfig.endpoint}/${record_id}`,
        this.buildRequestPayload(model, attrs),
        options
      )
        .then(() => {
          results[i] = { index: i, id: record_id as string, status: 'updated' }
        })
        .catch((error: HttpError) => {
          results[i] = {
            index: i,
            id: record_id as string,
            status: 'api_error',
            errors: [this._extractErrorMessage(error)],
            ...(error.response?.status && { status_code: error.response.status })
          }
        })
    })

    await this._runParallel(tasks)
    return results
  }

  /** Delete: remove records by ID */
  private async _executeDelete(
    modelConfig: ModelConfig,
    _model: string,
    recordIds: string[],
    options: Record<string, unknown>
  ): Promise<BulkResult[]> {
    const results = new Array<BulkResult>(recordIds.length)

    const tasks = recordIds.map(
      (id, i) => () =>
        this._api.delete!(`${modelConfig.endpoint}/${id}`, options)
          .then(() => {
            results[i] = { index: i, id, status: 'deleted' }
          })
          .catch((error: HttpError) => {
            results[i] = {
              index: i,
              id,
              status: 'api_error',
              errors: [this._extractErrorMessage(error)],
              ...(error.response?.status && { status_code: error.response.status })
            }
          })
    )

    await this._runParallel(tasks)
    return results
  }

  private _extractErrorMessage(error: HttpError): string {
    if (error.response?.data) {
      const raw =
        typeof error.response.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response.data)
      return this.truncateString(raw, 5000)
    }
    return error.message
  }

  /**
   * Run tasks with concurrency limit
   *
   * Spawns up to MAX_CONCURRENCY workers that pull from the shared task queue.
   * Each task function is expected to handle its own errors (via .catch).
   */
  private async _runParallel(tasks: Array<() => Promise<void>>): Promise<void> {
    let next = 0

    async function worker(): Promise<void> {
      while (next < tasks.length) {
        const i = next++
        await tasks[i]!()
      }
    }

    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_CONCURRENCY, tasks.length) }, () => worker())
    )
  }
}
