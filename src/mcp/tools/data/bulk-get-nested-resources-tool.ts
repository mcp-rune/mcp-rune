import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import { pickFields, sanitizeResponseData } from '#src/core/helpers.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseTool } from '../base-tool.js'
import type { NestedValidationError, NestedValidationSuccess } from '../validators.js'
import { validateNestedResource } from '../validators.js'

export const MAX_BATCH_SIZE = 25
const MAX_CONCURRENCY = 5

interface HttpError extends Error {
  response?: {
    status?: number
    data?: unknown
  }
}

interface BulkNestedResult {
  parent_id: string
  status: string
  data?: string
  errors?: string[]
}

/**
 * Tool for fetching nested resources for multiple parent records in a single call.
 *
 * Replaces individual get_nested_resources calls that hit the LLM's per-turn tool-use limit.
 * Uses parallel execution with concurrency cap and partial failure handling.
 */
export class BulkGetNestedResourcesTool extends BaseTool {
  override get name(): string {
    return 'bulk_get_nested_resources'
  }

  override get annotations(): ToolAnnotations {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return (
      `Get nested resources for multiple parent records${scope} in a single call (max ${MAX_BATCH_SIZE}). ` +
      'Fetches the same child resource for up to 25 parent IDs in parallel. ' +
      'Use this instead of calling get_nested_resources repeatedly for each parent. ' +
      'Handles partial failures gracefully.'
    )
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
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

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const { parent_model, parent_ids, child_resource, expand, fields } = args as {
        parent_model: string
        parent_ids: string[]
        child_resource: string
        expand?: string
        fields?: string[]
      }

      this.validateModel(parent_model)

      // Validate nested resource once (shared across all parent IDs)
      const validation = validateNestedResource(parent_model, child_resource, this.models)

      if (!validation.valid) {
        const err = validation as NestedValidationError
        if (this.logger) {
          this.logger.error('Nested resource validation failed', {
            service: 'mcp-tools',
            tool: this.name,
            parentModel: parent_model,
            childResource: child_resource,
            error: err.error,
            availableLinks: err.availableLinks,
            suggestion: err.suggestion
          })
        }
        return {
          content: [{ type: 'text', text: `${err.error}\n${err.suggestion}` }],
          isError: true
        }
      }

      const parentConfig = this.models[parent_model]!
      const linkInfo = (validation as NestedValidationSuccess).linkInfo as
        | Record<string, unknown>
        | undefined
      const childPath = (linkInfo?.path as string) || child_resource

      // Resolve expand params (explicit or auto-expand from target model metadata)
      const params: Record<string, unknown> = {}
      if (expand) {
        params.expand = expand
      } else {
        const autoExpand = this._resolveAutoExpand(validation as NestedValidationSuccess)
        if (autoExpand) {
          params.expand = autoExpand
        }
      }

      // Build one task per parent_id
      const results = new Array<BulkNestedResult>(parent_ids.length)
      const tasks = parent_ids.map((parentId, i) => () => {
        const endpoint = `${parentConfig.endpoint}/${parentId}/${childPath}`
        return this.apiClient!.get(endpoint, params)
          .then((data) => {
            results[i] = {
              parent_id: parentId,
              status: 'success',
              data: sanitizeResponseData(pickFields(data, fields))
            }
          })
          .catch((error: HttpError) => {
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
      const response = this.formatResponse(envelope as unknown as Record<string, unknown>)

      // isError only when ALL failed
      if (succeeded === 0) {
        ;(response as unknown as Record<string, unknown>).isError = true
      }

      return response
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  /** Resolve auto-expand from target model metadata */
  private _resolveAutoExpand(validation: NestedValidationSuccess): string | null {
    const linkInfo = validation.linkInfo as Record<string, unknown> | undefined
    const targetModel = linkInfo?.target_model as string | undefined
    if (!targetModel || !this.models[targetModel]) return null

    const targetModelConfig = this.models[targetModel]!
    const assoc = targetModelConfig.associations
    if (!assoc) return null

    const autoExpandLinks: string[] = []

    if (assoc.belongsTo) {
      Object.entries(assoc.belongsTo).forEach(([linkName, linkConfig]) => {
        if ((linkConfig as unknown as Record<string, unknown>).auto_expand) {
          autoExpandLinks.push(linkName)
        }
      })
    }

    if (assoc.hasMany) {
      Object.entries(assoc.hasMany).forEach(([linkName, linkConfig]) => {
        if ((linkConfig as unknown as Record<string, unknown>).auto_expand) {
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

  private _extractErrorMessage(error: HttpError): string {
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
