import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import {
  getIngestedRecordCount,
  getIngestedRecordDryRun,
  getIngestedRecordIdsFiltered
} from '#src/services/vector-storage.js'

import type { ModelConfig, ToolAnnotations, ToolResult } from '../base-tool.js'
import type { ToolCategory } from '../categories.js'
import { TOOL_CATEGORIES } from '../categories.js'
import { SaveModelBaseTool } from '../save-model-base-tool.js'

/** Max records per internal batch. Higher than bulk_action_models (25) because
 *  batches are never surfaced to the LLM — only the aggregate response is. */
export const MAX_ACT_BATCH_SIZE = 50

const MAX_CONCURRENCY = 5
const MAX_SAMPLE_ERRORS = 5

interface ActResult {
  index: number
  id: string
  status: 'updated' | 'deleted' | 'api_error'
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
 * Apply a bulk update or delete to records resolved from an analysis session.
 *
 * Part of the analysis_* tool family:
 *   analysis_ingest → analysis_store → analysis_query → analysis_act → analysis_clear
 *
 * Reads IDs from ingested_records using the same WHERE vocabulary as
 * analysis_query mode: "filter", then runs PATCH/DELETE against the API in
 * batches with a concurrency cap. Only an aggregate summary is returned to
 * context — per-record results are logged, never echoed to the LLM.
 *
 * Uses ANALYSIS category (vector-storage-gated) but inherits write helpers
 * (buildRequestPayload) from SaveModelBaseTool; requiresAuth is forced true
 * because the tool calls the upstream API.
 */
export class AnalysisActTool extends SaveModelBaseTool {
  static override get category(): ToolCategory {
    return TOOL_CATEGORIES.ANALYSIS
  }

  static override get requiresAuth(): boolean {
    return true
  }

  override get name(): string {
    return 'analysis_act'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  }

  override get baseDescription(): string {
    const scope = this.serverContext.name ? ` in the ${this.serverContext.name} API` : ''
    return `Apply a bulk update or delete${scope} to records previously ingested in this analysis session.

Resolves matching record IDs server-side from ingested_records using the same WHERE vocabulary as analysis_query mode: "filter", then runs the mutation in batches. Only an aggregate summary returns to context — per-record IDs and results never inflate the LLM window.

Use this instead of analysis_query + bulk_action_models when you need to mutate a subset of an analysis session larger than ~25 records.

1. Ingest with analysis_ingest first; analysis_act reads from that session.
2. Preview with dry_run: true before committing — returns matched_count, a small sample, and ingestedAt range so you can judge snapshot staleness.
3. Run live (dry_run: false or omitted) once the preview looks right.

Action semantics:
- "update": requires attributes; applies the same attributes to every matched record.
- "delete": ignores attributes; deletes every matched record.

Failure model: batches are not atomic across the whole set (matches bulk_action_models semantics). A partial failure mid-run leaves earlier batches applied. The response includes summary counts and a sample of error messages — full per-record results live in the server log.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    return {
      analysis_id: z
        .string()
        .describe('Analysis session ID — must match a prior analysis_ingest call.'),
      model: this.zodEnum(this.getWritableModelNames()).describe(
        'Model name. Must be a writable model present in the analysis session.'
      ),
      where: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Filter predicate. Same vocabulary as analysis_query mode: "filter": exact match (JSONB containment) plus $gt/$gte/$lt/$lte for numeric or date ranges. Omit to match every record of `model` in the session.'
        ),
      action: z.enum(['update', 'delete']).describe('Mutation to apply.'),
      attributes: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Attributes to apply to every matched record. Required when action: "update", ignored when action: "delete".'
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'When true, returns { matched_count, sample_ids, sample_data, ingestedAtRange } without calling the API. Use this to confirm scope and snapshot age before mutating.'
        ),
      user_id: z.string().describe('User ID to impersonate (service accounts only).').optional()
    }
  }

  override getUsageRules(): string[] {
    return []
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      this.requireApiClient()

      const {
        analysis_id,
        model,
        where,
        action,
        attributes,
        dry_run = false,
        user_id
      } = args as {
        analysis_id: string
        model: string
        where?: Record<string, unknown>
        action: 'update' | 'delete'
        attributes?: Record<string, unknown>
        dry_run?: boolean
        user_id?: string
      }

      this.validateModel(model)
      const modelConfig = this.getModelConfig(model)!

      if (modelConfig.api?.readOnly) {
        throw new Error(
          `The '${model}' model is read-only and cannot be modified. ` +
            `${modelConfig.description ? modelConfig.description + ' ' : ''}` +
            'Use analysis_query to inspect records instead.'
        )
      }

      if (action === 'update' && (!attributes || Object.keys(attributes).length === 0)) {
        throw new Error(
          "action 'update' requires 'attributes' — pass the fields to apply to every matched record."
        )
      }

      const sessionCount = await getIngestedRecordCount(analysis_id, model)
      if (sessionCount === 0) {
        throw new Error(
          `No ingested records found for model '${model}' in analysis '${analysis_id}'. ` +
            'Call analysis_ingest first, or check the analysis_id / model spelling.'
        )
      }

      if (dry_run) {
        return this._dryRun(analysis_id, model, where)
      }

      const recordIds = await getIngestedRecordIdsFiltered(analysis_id, model, where)
      if (recordIds.length === 0) {
        return this.formatResponse({
          summary: { total: 0, succeeded: 0, failed: 0, action },
          sample_errors: []
        })
      }

      const options = user_id ? { userId: user_id } : {}
      const total = recordIds.length
      let completed = 0

      const onProgress = (): void => {
        completed++
        void this.sendProgress({
          progress: completed,
          total,
          message: `${action}: ${completed}/${total} records processed`
        })
      }

      const allResults: ActResult[] = []
      let baseIndex = 0
      for (let i = 0; i < recordIds.length; i += MAX_ACT_BATCH_SIZE) {
        const batchIds = recordIds.slice(i, i + MAX_ACT_BATCH_SIZE)
        const batchResults =
          action === 'update'
            ? await this._executeUpdateBatch(
                modelConfig,
                model,
                batchIds,
                attributes!,
                options,
                baseIndex,
                onProgress
              )
            : await this._executeDeleteBatch(modelConfig, batchIds, options, baseIndex, onProgress)
        allResults.push(...batchResults)
        baseIndex += batchIds.length
      }

      const succeeded = allResults.filter(
        (r) => r.status === 'updated' || r.status === 'deleted'
      ).length
      const failed = allResults.length - succeeded
      const summary = { total: allResults.length, succeeded, failed, action }
      const sample_errors = allResults
        .filter((r) => r.status === 'api_error')
        .slice(0, MAX_SAMPLE_ERRORS)

      if (this.logger) {
        this.logger.info('analysis_act completed', {
          service: 'mcp-tools',
          tool: 'analysis_act',
          analysis_id,
          model,
          action,
          total: summary.total,
          succeeded: summary.succeeded,
          failed: summary.failed,
          impersonating: user_id ?? null
        })
      }

      this.storeToolMemory({
        toolName: 'analysis_act',
        toolArgs: { model, action, record_count: summary.total },
        toolOutput: summary,
        userId: user_id
      })

      const response = this.formatResponse({ summary, sample_errors })
      if (succeeded === 0 && summary.total > 0) {
        ;(response as unknown as Record<string, unknown>).isError = true
      }
      return response
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  private async _dryRun(
    analysisId: string,
    model: string,
    where: Record<string, unknown> | undefined
  ): Promise<ToolResult> {
    const result = await getIngestedRecordDryRun(analysisId, model, where)
    return this.formatResponse({
      matched_count: result.matchedCount,
      sample_ids: result.sampleIds,
      sample_data: result.sampleData,
      ingestedAtRange: {
        earliest: result.earliestIngestedAt,
        latest: result.latestIngestedAt
      }
    })
  }

  private async _executeUpdateBatch(
    modelConfig: ModelConfig,
    model: string,
    recordIds: string[],
    attributes: Record<string, unknown>,
    options: Record<string, unknown>,
    baseIndex: number,
    onProgress: () => void
  ): Promise<ActResult[]> {
    const results = new Array<ActResult>(recordIds.length)
    const payload = this.buildRequestPayload(model, attributes)

    const tasks = recordIds.map(
      (id, i) => () =>
        this.apiClient!.patch(this._resolveRecordEndpoint(modelConfig, id), payload, options)
          .then(() => {
            results[i] = { index: baseIndex + i, id, status: 'updated' }
          })
          .catch((error: HttpError) => {
            results[i] = {
              index: baseIndex + i,
              id,
              status: 'api_error',
              errors: [this._extractErrorMessage(error)],
              ...(error.response?.status && { status_code: error.response.status })
            }
          })
          .finally(onProgress)
    )

    await this._runParallel(tasks)
    return results
  }

  private async _executeDeleteBatch(
    modelConfig: ModelConfig,
    recordIds: string[],
    options: Record<string, unknown>,
    baseIndex: number,
    onProgress: () => void
  ): Promise<ActResult[]> {
    const results = new Array<ActResult>(recordIds.length)

    const tasks = recordIds.map(
      (id, i) => () =>
        this.apiClient!.delete(this._resolveRecordEndpoint(modelConfig, id), options)
          .then(() => {
            results[i] = { index: baseIndex + i, id, status: 'deleted' }
          })
          .catch((error: HttpError) => {
            results[i] = {
              index: baseIndex + i,
              id,
              status: 'api_error',
              errors: [this._extractErrorMessage(error)],
              ...(error.response?.status && { status_code: error.response.status })
            }
          })
          .finally(onProgress)
    )

    await this._runParallel(tasks)
    return results
  }

  private _resolveRecordEndpoint(modelConfig: ModelConfig, recordId: string): string {
    return recordId.includes('/') ? recordId : `${modelConfig.api.endpoint}/${recordId}`
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

  private async _runParallel(tasks: Array<() => Promise<void>>): Promise<void> {
    let next = 0
    const total = tasks.length

    async function worker(): Promise<void> {
      while (next < total) {
        const i = next++
        await tasks[i]!()
      }
    }

    await Promise.allSettled(
      Array.from({ length: Math.min(MAX_CONCURRENCY, total) }, () => worker())
    )
  }
}
