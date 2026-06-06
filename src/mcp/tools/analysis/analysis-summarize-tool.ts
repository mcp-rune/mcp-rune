import type { ZodTypeAny } from 'zod'
import { z } from 'zod'

import type {
  SummaryEdge,
  SummaryInput,
  SummaryStrategyRegistry
} from '#src/mcp/models/summary-strategies/index.js'
import { defaultSummaryStrategyRegistry } from '#src/mcp/models/summary-strategies/index.js'
import {
  describeAnalysisSession,
  getEdgesForSources,
  getEmbeddingsForRecords,
  queryIngestedData,
  storeAnalysisMemory
} from '#src/runtime/vector-storage.js'

import type { ToolAnnotations, ToolResult } from '../base-tool.js'
import { BaseAnalysisTool } from './base-analysis-tool.js'

const DEFAULT_MAX_RECORDS = 1000
const MAX_RECORDS_CAP = 5000

/**
 * Re-run summary strategies against an already-ingested analysis session
 * without re-fetching from the source API. Useful when you ingested with
 * the default `distribution` strategy and now want a different lens
 * (anomaly / temporal / entity-extraction / coverage) over the same data.
 *
 * Part of the analysis_* tool family:
 *   analysis_ingest → analysis_store → analysis_query → analysis_summarize → analysis_clear
 */
export class AnalysisSummarizeTool extends BaseAnalysisTool {
  override get name(): string {
    return 'analysis_summarize'
  }

  override get annotations(): ToolAnnotations {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }

  override get baseDescription(): string {
    return `Re-summarize an already-ingested analysis session with one or more strategies, without re-fetching from the API.

Use this after analysis_ingest when you want a different lens on the same data — e.g. you ingested with the default 'distribution' strategy and now want anomaly/temporal/entity-extraction views. Each strategy stores one analysis memory with category page_summary:<strategy>, recallable via analysis_query mode: semantic.

Strategies whose appliesTo() returns false for the loaded records are silently skipped (e.g. temporal skips when no ISO-date field is present).

When NOT to use: for the first ingestion of a session — use analysis_ingest, which can already run multiple strategies via summary_strategies: [...] at fetch time.`
  }

  override get inputSchema(): Record<string, ZodTypeAny> {
    const names = this._availableStrategyNames()
    return {
      analysis_id: z.string().describe('Analysis session to re-summarize.'),
      model: this.zodEnum(this.getModelNames())
        .optional()
        .describe(
          "Override the model. Defaults to the session's ingested model (resolved via describeAnalysisSession)."
        ),
      strategy: this.zodEnum(names).optional().describe(this._summaryStrategyParamDescription()),
      strategies: z
        .array(this.zodEnum(names))
        .optional()
        .describe(
          'Run multiple strategies in order; each produces a separate page_summary:<strategy> memory. Mutually exclusive with `strategy`.'
        ),
      where: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Optional filter (same operator vocabulary as analysis_query mode: filter) scoping which stored records the strategies see.'
        ),
      max_records: z
        .number()
        .int()
        .positive()
        .max(MAX_RECORDS_CAP)
        .optional()
        .describe(
          `Cap on records loaded per run. Default ${DEFAULT_MAX_RECORDS}; max ${MAX_RECORDS_CAP}.`
        )
    }
  }

  override getUsageRules(): string[] {
    return []
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const {
        analysis_id,
        model: modelOverride,
        strategy,
        strategies,
        where,
        max_records = DEFAULT_MAX_RECORDS
      } = args as {
        analysis_id: string
        model?: string
        strategy?: string
        strategies?: string[]
        where?: Record<string, unknown>
        max_records?: number
      }

      if (strategy && strategies) {
        return this._textError('Provide either `strategy` or `strategies`, not both.')
      }
      const names =
        strategies && strategies.length > 0 ? strategies : strategy ? [strategy] : ['distribution']

      let resolvedModel = modelOverride
      if (!resolvedModel) {
        const session = await describeAnalysisSession(analysis_id)
        if (!session) {
          return this._textError(
            `No ingested data found for analysis "${analysis_id}". Run analysis_ingest first.`
          )
        }
        resolvedModel = session.model
      } else {
        this.validateModel(resolvedModel)
      }

      const records =
        where && Object.keys(where).length > 0
          ? await queryIngestedData(analysis_id, {
              mode: 'filter',
              where,
              limit: max_records
            })
          : await queryIngestedData(analysis_id, {
              mode: 'sample',
              sampleSize: max_records
            })

      const registry = this._registry()
      const needs = this._collectRequirements(names, registry)
      const baseInput: SummaryInput = {
        analysisId: analysis_id,
        model: resolvedModel,
        page: 1,
        totalPages: 1,
        records,
        fields: undefined
      }
      let enriched: SummaryInput = baseInput
      if (needs.edges) {
        enriched = { ...enriched, edges: await this._loadEdgesForPage(enriched) }
      }
      if (needs.embeddings) {
        enriched = { ...enriched, embeddings: await this._loadEmbeddingsForPage(enriched) }
      }
      if (needs.domainRegistry && this.domainRegistry) {
        enriched = {
          ...enriched,
          domainRegistry: this.domainRegistry as SummaryInput['domainRegistry']
        }
      }

      const results: string[] = []
      for (const name of names) {
        const s = registry.get(name)
        if (!s) return this._textError(`Unknown summary strategy: "${name}".`)
        if (s.appliesTo && !s.appliesTo(enriched)) {
          results.push(`${name}: skipped (appliesTo=false)`)
          continue
        }
        const output = await s.generate(enriched)
        await storeAnalysisMemory({
          analysisId: analysis_id,
          finding: output.finding,
          category: output.category ?? `page_summary:${s.name}`,
          metadata: { ...output.metadata, strategy: s.name, source: 'analysis_summarize' }
        })
        results.push(`${name}: stored (${output.finding.length} chars)`)
      }

      return this.formatResponse(
        `Re-summarized ${records.length} record(s) of ${resolvedModel} for analysis ${analysis_id}.\n` +
          results.join('\n'),
        { meta: { context: { consumed: true } } }
      )
    } catch (error) {
      return this.formatError(error as Error)
    }
  }

  private _registry(): SummaryStrategyRegistry {
    return this.summaryStrategies ?? defaultSummaryStrategyRegistry()
  }

  private _collectRequirements(
    strategyNames: ReadonlyArray<string>,
    registry: SummaryStrategyRegistry
  ): { edges: boolean; embeddings: boolean; domainRegistry: boolean } {
    let edges = false
    let embeddings = false
    let domainRegistry = false
    for (const name of strategyNames) {
      const strategy = registry.get(name)
      for (const r of strategy?.requires ?? []) {
        if (r === 'edges') edges = true
        else if (r === 'embeddings') embeddings = true
        else if (r === 'domainRegistry') domainRegistry = true
      }
    }
    return { edges, embeddings, domainRegistry }
  }

  private async _loadEmbeddingsForPage(
    input: SummaryInput
  ): Promise<ReadonlyMap<string, Float32Array>> {
    const ids: string[] = []
    for (const r of input.records) {
      if (r.id != null) ids.push(String(r.id))
    }
    if (ids.length === 0) return new Map()
    return getEmbeddingsForRecords(input.analysisId, input.model, ids)
  }

  private async _loadEdgesForPage(input: SummaryInput): Promise<ReadonlyArray<SummaryEdge>> {
    const srcIds: string[] = []
    for (const r of input.records) {
      if (r.id != null) srcIds.push(String(r.id))
    }
    if (srcIds.length === 0) return []
    const rows = await getEdgesForSources(input.analysisId, input.model, srcIds)
    return rows.map((r) => ({
      src_id: r.src_id,
      dst_model: r.dst_model,
      dst_id: r.dst_id,
      edge_type: r.edge_type
    }))
  }

  private _availableStrategyNames(): string[] {
    return this._registry().names()
  }

  private _summaryStrategyParamDescription(): string {
    const registry = this._registry()
    const head = 'Summary strategy to run. Default: "distribution". Available:'
    const lines = registry.all().map((s) => `- ${s.name}: ${s.description}`)
    return `${head}\n${lines.join('\n')}`
  }

  private _textError(text: string): ToolResult {
    return { content: [{ type: 'text', text }], isError: true }
  }
}
