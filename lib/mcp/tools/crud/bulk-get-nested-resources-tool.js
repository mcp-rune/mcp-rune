import { z } from 'zod'
import { BaseTool } from '../base-tool.js'
import { validateNestedResource } from '../validators.js'
import { sanitizeResponseData, pickFields } from '#lib/core/helpers.js'

export const MAX_BATCH_SIZE = 25
const MAX_CONCURRENCY = 5

/**
 * Tool for fetching nested resources for multiple parent records in a single call.
 *
 * Replaces individual get_nested_resources calls that hit the LLM's per-turn tool-use limit.
 * Uses parallel execution with concurrency cap and partial failure handling.
 */
export class BulkGetNestedResourcesTool extends BaseTool {
  get name() {
    return 'bulk_get_nested_resources'
  }

  get baseDescription() {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return (
      `Get nested resources for multiple parent records${scope} in a single call (max ${MAX_BATCH_SIZE}). ` +
      'Fetches the same child resource for up to 25 parent IDs in parallel. ' +
      'Use this instead of calling get_nested_resources repeatedly for each parent. ' +
      'Handles partial failures gracefully.'
    )
  }

  get inputSchema() {
    return {
      parent_model: this.zodEnum(this.getModelNames()).describe('Parent model name'),
      parent_ids: z
        .array(z.string())
        .min(1)
        .max(MAX_BATCH_SIZE)
        .describe('Array of parent record IDs to fetch nested resources for'),
      child_resource: z
        .string()
        .describe("Child resource name (e.g., 'books', 'categories', 'tags')"),
      expand: z
        .string()
        .describe(
          'Comma-separated list of associations to expand. Only works with expandable links as defined in model metadata.'
        )
        .optional(),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to include in response (e.g., ["id", "name", "status"]). Omit for all fields.'
        )
    }
  }

  async execute(args) {
    try {
      this.requireApiClient()

      const { parent_model, parent_ids, child_resource, expand, fields } = args

      this.validateModel(parent_model)

      // Validate nested resource once (shared across all parent IDs)
      const validation = validateNestedResource(parent_model, child_resource, this.models)

      if (!validation.valid) {
        if (this.logger) {
          this.logger.error('Nested resource validation failed', {
            service: 'mcp-tools',
            tool: this.name,
            parentModel: parent_model,
            childResource: child_resource,
            error: validation.error,
            availableLinks: validation.availableLinks,
            suggestion: validation.suggestion
          })
        }
        return {
          content: [{ type: 'text', text: `${validation.error}\n${validation.suggestion}` }],
          isError: true
        }
      }

      const parentConfig = this.models[parent_model]
      const childPath = validation.linkInfo?.path || child_resource

      // Resolve expand params (explicit or auto-expand from target model metadata)
      const params = {}
      if (expand) {
        params.expand = expand
      } else {
        const autoExpand = this._resolveAutoExpand(validation)
        if (autoExpand) {
          params.expand = autoExpand
        }
      }

      // Build one task per parent_id
      const results = new Array(parent_ids.length)
      const tasks = parent_ids.map((parentId, i) => () => {
        const endpoint = `${parentConfig.endpoint}/${parentId}/${childPath}`
        return this.apiClient
          .get(endpoint, params)
          .then((data) => {
            results[i] = {
              parent_id: parentId,
              status: 'success',
              data: sanitizeResponseData(pickFields(data, fields))
            }
          })
          .catch((error) => {
            results[i] = {
              parent_id: parentId,
              status: 'error',
              errors: [this._extractErrorMessage(error)]
            }
          })
      })

      await this._runParallel(tasks)

      const succeeded = results.filter((r) => r.status === 'success').length
      const failed = results.length - succeeded
      const summary = { total: results.length, succeeded, failed }

      if (this.logger) {
        this.logger.info('Bulk get nested resources completed', {
          service: 'mcp-tools',
          tool: this.name,
          parentModel: parent_model,
          childResource: child_resource,
          ...summary
        })
      }

      const envelope = { summary, results }
      const response = this.formatResponse(envelope)

      // isError only when ALL failed
      if (succeeded === 0) {
        response.isError = true
      }

      return response
    } catch (error) {
      return this.formatError(error)
    }
  }

  /**
   * Resolve auto-expand from target model metadata
   * @param {Object} validation - Validation result from validateNestedResource
   * @returns {string|null} Comma-separated expand string or null
   */
  _resolveAutoExpand(validation) {
    const targetModel = validation.linkInfo?.target_model
    if (!targetModel || !this.models[targetModel]) return null

    const targetModelConfig = this.models[targetModel]
    const assoc = targetModelConfig.associations
    if (!assoc) return null

    const autoExpandLinks = []

    if (assoc.belongsTo) {
      Object.entries(assoc.belongsTo).forEach(([linkName, linkConfig]) => {
        if (linkConfig.auto_expand) {
          autoExpandLinks.push(linkName)
        }
      })
    }

    if (assoc.hasMany) {
      Object.entries(assoc.hasMany).forEach(([linkName, linkConfig]) => {
        if (linkConfig.auto_expand) {
          autoExpandLinks.push(linkName)
        }
      })
    }

    if (autoExpandLinks.length > 0) {
      if (this.logger) {
        this.logger.debug('Auto-expanding associations from model metadata', {
          service: 'mcp-tools',
          tool: this.name,
          targetModel,
          autoExpand: autoExpandLinks.join(',')
        })
      }
      return autoExpandLinks.join(',')
    }

    return null
  }

  _extractErrorMessage(error) {
    if (error.response?.data) {
      return typeof error.response.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response.data)
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
