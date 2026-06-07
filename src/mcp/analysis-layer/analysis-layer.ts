/**
 * AnalysisLayer — the per-model-bound seam for analysis-domain operations
 * driven by a Model class's static configuration and a per-request DataLayer.
 *
 *   class Episode extends BaseModel {
 *     static associations = {
 *       belongsTo: { title:    { target_model: 'title'    } },
 *       hasMany:   { segments: { target_model: 'segment'  } }
 *     }
 *   }
 *
 *   const epAnalysis = analysisLayer('episode')          // bound to Episode + this request's DataLayer
 *
 *   epAnalysis.extractEdges({ id: 1, title_id: 7, segment_ids: [2, 3] })
 *     → [{ src: episode/1 → title/7, edge_type: 'belongsTo:title' },
 *        { src: episode/1 → segment/2, edge_type: 'hasMany:segments' }, …]
 *
 * AnalysisLayer is an **independent peer** of `ModelLayer` — not a
 * subclass. ModelLayer reads model config; AnalysisLayer projects records
 * into the shapes the analysis pipeline needs (edges today; embedding text,
 * hops, summaries, stratifiers in later PRs).
 *
 * Because some analysis operations (e.g. `walkHops`) need to fetch
 * destination records, AnalysisLayer is **per-request**: it carries the
 * authenticated `DataLayer` for this invocation, mirroring how `DataLayer`
 * itself is constructed per request.
 *
 * Consumers receive an `AnalysisLayerFactory` via
 * `ToolDependencies.analysisLayer` / `context.analysisLayer` and call it
 * with a model name to get a bound layer. Never import
 * `extractEdgesFromRecord` etc. directly.
 */

import type { DataLayer } from '#src/mcp/data-layer/data-layer.js'
import type { AssociationConfig } from '#src/mcp/models/model-definitions.js'
import type { ModelClassLike } from '#src/mcp/schema/types.js'
import type { ModelsRegistry } from '#src/mcp/tools/base-tool.js'

import {
  buildEmbeddingText as buildEmbeddingTextImpl,
  type Edge,
  type EmbeddingTextOptions,
  extractEdgesFromRecord,
  type ExtractOptions
} from './edge-extraction.js'

export type { Edge, EmbeddingTextOptions, ExtractOptions }

export interface AnalysisLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /** The name of the bound model — used as `src_model` on emitted edges. */
  readonly modelName: string

  /**
   * Extract typed edges from a record using the bound model's declared
   * `belongsTo` and `hasMany` associations. `belongsTo` emits one edge
   * per non-null `<rel>_id`; `hasMany` emits one edge per element of
   * `<singular>_ids`.
   */
  extractEdges(record: Record<string, unknown>, options?: ExtractOptions): Edge[]

  /**
   * Deterministically textify a record for embedding: concatenates
   * `<field>: <value>` for each string-valued attribute, sorted by field
   * name, with `id` and `*_id` fields skipped. Truncates at
   * `options.maxLength` (default 512).
   */
  buildEmbeddingText(record: Record<string, unknown>, options?: EmbeddingTextOptions): string
}

export interface AnalysisLayerContext {
  /** Model class to bind this layer to. */
  model: ModelClassLike
  /** Name of the bound model in the registry. */
  modelName: string
  /**
   * Per-request DataLayer. Required so I/O-bearing methods (walkHops,
   * added in a later PR) can fetch destination records.
   */
  dataLayer: DataLayer
}

/**
 * Create an AnalysisLayer bound to a specific model + DataLayer.
 *
 * The returned object holds the DataLayer reference for as long as the
 * caller does, so the lifetime should match the authenticated request.
 */
export function createAnalysisLayer(ctx: AnalysisLayerContext): AnalysisLayer {
  return {
    model: ctx.model,
    modelName: ctx.modelName,
    extractEdges(record, options) {
      // ModelClassLike.associations is the deliberately-loose schema type
      // (target_model optional); the registered ModelConfig narrows this to
      // AssociationConfig at boot via model-validator. Cast is safe at this
      // boundary because every model reaching the factory has been validated.
      return extractEdgesFromRecord(
        record,
        ctx.model.associations as AssociationConfig | undefined,
        ctx.modelName,
        options
      )
    },
    buildEmbeddingText(record, options) {
      return buildEmbeddingTextImpl(record, options)
    }
  }
}

/**
 * A factory function that resolves a model name to its bound `AnalysisLayer`
 * for the current request's authenticated context. Injected on
 * `ToolDependencies.analysisLayer` and on the app handler context as
 * `context.analysisLayer`.
 *
 * Each invocation may return a fresh layer or a cached one — callers must
 * not assume stable identity across calls.
 */
export type AnalysisLayerFactory = (modelName: string) => AnalysisLayer

/**
 * Build an `AnalysisLayerFactory` over a fixed `ModelsRegistry` and a
 * per-request `DataLayer`. Throws on unknown model names.
 */
export function createAnalysisLayerFactory(
  models: ModelsRegistry,
  dataLayer: DataLayer
): AnalysisLayerFactory {
  const cache = new Map<string, AnalysisLayer>()
  return (modelName: string): AnalysisLayer => {
    const cached = cache.get(modelName)
    if (cached) return cached
    const model = models[modelName] as ModelClassLike | undefined
    if (!model) {
      throw new Error(
        `AnalysisLayer factory: unknown model "${modelName}". ` +
          `Registered: ${Object.keys(models).join(', ') || '(none)'}.`
      )
    }
    const layer = createAnalysisLayer({ model, modelName, dataLayer })
    cache.set(modelName, layer)
    return layer
  }
}
