import { z } from 'zod'
import { SaveModelBaseTool } from '../save-model-base-tool.js'
import { storeOperation } from '#lib/services/memory-storage.js'

export const MAX_BATCH_SIZE = 25
const MAX_CONCURRENCY = 5

/**
 * Tool for creating, updating, or deleting multiple records in a single tool call
 *
 * Replaces individual tool calls that hit Claude Desktop's per-turn tool-use limit.
 * Uses parallel execution with concurrency cap and partial failure handling.
 */
export class BulkActionModelsTool extends SaveModelBaseTool {
  get name() {
    return 'bulk_action_models'
  }

  get baseDescription() {
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

  get inputSchema() {
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

  async execute(args) {
    try {
      this.requireApiClient()

      const { model, action, user_id, parent_resource } = args

      this.validateModel(model)

      const modelConfig = this.getModelConfig(model)

      if (modelConfig.api?.readOnly) {
        throw new Error(
          `The '${model}' model is read-only and cannot be modified. ` +
            `${modelConfig.description ? modelConfig.description + ' ' : ''}` +
            'Use find_model to look up existing records.'
        )
      }

      this._validateArgs(action, args)

      const options = user_id ? { userId: user_id } : {}
      let results

      switch (action) {
        case 'create':
          results = await this._executeCreate(
            modelConfig,
            model,
            args.records,
            options,
            parent_resource
          )
          break
        case 'update':
          results = args.record_ids
            ? await this._executeUniformUpdate(
                modelConfig,
                model,
                args.record_ids,
                args.attributes,
                options
              )
            : await this._executePerRecordUpdate(modelConfig, model, args.records, options)
          break
        case 'delete':
          results = await this._executeDelete(modelConfig, model, args.record_ids, options)
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
          action,
          ...summary,
          impersonating: user_id || null
        })
      }

      storeOperation({
        toolName: 'bulk_action_models',
        toolArgs: { model, action, record_count: results.length },
        toolOutput: summary,
        userId: user_id,
        sessionId: this.serverContext?.sessionId
      }).catch((err) => {
        if (this.logger) {
          this.logger.warn('Vector storage failed', { service: 'mcp-tools', error: err.message })
        }
      })

      const envelope = { summary, results }
      const response = this.formatResponse(envelope)

      // isError only when ALL records failed
      if (succeeded === 0) {
        response.isError = true
      }

      return response
    } catch (error) {
      return this.formatError(error)
    }
  }

  /**
   * Validate args per action (imperative, not Zod refine — keeps schema flat and LLM-friendly)
   */
  _validateArgs(action, args) {
    switch (action) {
      case 'create':
        if (!args.records || args.records.length === 0) {
          throw new Error("action 'create' requires 'records' array.")
        }
        if (args.parent_resource && args.records.some((r) => r.parent_resource)) {
          throw new Error(
            'Cannot combine tool-level parent_resource with per-record parent_resource. ' +
              'Use EITHER the parent_resource parameter (all records share one parent) ' +
              'OR parent_resource inside each record (each record specifies its own parent).'
          )
        }
        break
      case 'update':
        if (args.record_ids) {
          if (!args.attributes || Object.keys(args.attributes).length === 0) {
            throw new Error("Uniform update (record_ids) requires 'attributes'.")
          }
        } else if (args.records) {
          for (let i = 0; i < args.records.length; i++) {
            if (!args.records[i].record_id) {
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
        if (!args.record_ids || args.record_ids.length === 0) {
          throw new Error("action 'delete' requires 'record_ids' array.")
        }
        break
    }
  }

  /**
   * Prepare create: extract per-record parent_resource, resolve endpoints, validate required fields.
   * Returns { records, endpoints, results, validIndices } for _executeCreate.
   */
  _prepareCreate(modelConfig, model, records, parentResource) {
    const nestedOnly = modelConfig.api?.nested?.nestedOnly
    const requiredFields = modelConfig.required || []
    const results = new Array(records.length)
    const endpoints = new Array(records.length)
    const cleanRecords = new Array(records.length)
    const validIndices = []

    for (let i = 0; i < records.length; i++) {
      const { parent_resource: recordParent, ...attrs } = records[i]
      cleanRecords[i] = attrs

      // Resolve endpoint
      const effectiveParent = recordParent || parentResource
      if (effectiveParent) {
        endpoints[i] = effectiveParent
      } else if (nestedOnly) {
        const parentModels = modelConfig.api?.nested?.parentModels || []
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

  /**
   * Execute create: prepare records then run parallel API calls.
   * Supports both tool-level and per-record parent_resource.
   */
  async _executeCreate(modelConfig, model, records, options, parentResource) {
    const {
      records: cleanRecords,
      endpoints,
      results,
      validIndices
    } = this._prepareCreate(modelConfig, model, records, parentResource)

    const tasks = validIndices.map(
      (i) => () =>
        this.apiClient
          .post(endpoints[i], this.buildRequestPayload(model, cleanRecords[i]), options)
          .then((data) => {
            results[i] = { index: i, status: 'created', id: data.id }
          })
          .catch((error) => {
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

  /**
   * Uniform update: same attributes applied to all record_ids
   */
  async _executeUniformUpdate(modelConfig, model, recordIds, attributes, options) {
    const results = new Array(recordIds.length)

    const tasks = recordIds.map(
      (id, i) => () =>
        this.apiClient
          .patch(
            `${modelConfig.endpoint}/${id}`,
            this.buildRequestPayload(model, attributes),
            options
          )
          .then(() => {
            results[i] = { index: i, id, status: 'updated' }
          })
          .catch((error) => {
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

  /**
   * Per-record update: each record has its own record_id and attributes
   */
  async _executePerRecordUpdate(modelConfig, model, records, options) {
    const results = new Array(records.length)

    const tasks = records.map((record, i) => () => {
      const { record_id, ...attrs } = record
      return this.apiClient
        .patch(
          `${modelConfig.endpoint}/${record_id}`,
          this.buildRequestPayload(model, attrs),
          options
        )
        .then(() => {
          results[i] = { index: i, id: record_id, status: 'updated' }
        })
        .catch((error) => {
          results[i] = {
            index: i,
            id: record_id,
            status: 'api_error',
            errors: [this._extractErrorMessage(error)],
            ...(error.response?.status && { status_code: error.response.status })
          }
        })
    })

    await this._runParallel(tasks)
    return results
  }

  /**
   * Delete: remove records by ID
   */
  async _executeDelete(modelConfig, _model, recordIds, options) {
    const results = new Array(recordIds.length)

    const tasks = recordIds.map(
      (id, i) => () =>
        this.apiClient
          .delete(`${modelConfig.endpoint}/${id}`, options)
          .then(() => {
            results[i] = { index: i, id, status: 'deleted' }
          })
          .catch((error) => {
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

  _extractErrorMessage(error) {
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
  async _runParallel(tasks) {
    let next = 0

    async function worker() {
      while (next < tasks.length) {
        const i = next++
        await tasks[i]()
      }
    }

    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_CONCURRENCY, tasks.length) }, () => worker())
    )
  }
}
