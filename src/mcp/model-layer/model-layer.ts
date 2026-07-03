/**
 * ModelLayer — the per-model-bound seam between mcp-rune's projection
 * layer (apps, prompts, tools, ApiExtensions) and the static configuration
 * declared on a Model class.
 *
 *   class Book extends BaseModel {
 *     static attributes = {
 *       title:       { type: 'string', required: true },
 *       author_name: { type: 'string', derived: { from: 'author', field: 'name' } }
 *     }
 *   }
 *
 *   const bookModel = modelLayer('book')       // bound to Book at construction
 *
 *   bookModel.resolveDerivedFields(records)    // → records with author_name copied out
 *
 * Every method operates on the model bound at construction; there is no
 * `(modelName, …)` first argument. ModelLayer is purely synchronous — it
 * reads static metadata only and does no I/O. Analysis-domain operations
 * (edges, embeddings, hops, summaries) live on the peer `AnalysisLayer`.
 *
 * Consumers (apps, prompts, tools) receive a `ModelLayerFactory` via
 * `context.modelLayer` / `ToolDependencies.modelLayer` and call it with a
 * model name to get a bound layer. Never import the layer's internal
 * helpers (`resolveDerivedFields` from `./derived-fields.js`,
 * `collectValidFieldNames`, `derivePromptSchema`, `validateRequired`)
 * directly from projection code.
 *
 * Kind descriptors are NOT reached through this layer: kinds are shared
 * vocabulary (ADR 0009, `docs/architecture/decisions/`), read directly via
 * `getKind` / `kindOptsFrom` / `resolveInputType` from
 * `#src/mcp/models/kinds/index.js` — they are boot-static, pure, and also
 * needed for prompt-only fields no model ever declares.
 */

import type { ModelsRegistry } from '#src/mcp/models/model-definitions.js'
import type { ModelClassLike } from '#src/mcp/schema/types.js'

import { resolveDerivedFields as resolveDerivedFieldsImpl } from './derived-fields.js'

export interface ModelLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /**
   * Flatten nested association data into top-level fields, in place, on a
   * list of records. Driven by `derived: { from, field }` declarations on
   * the bound model's attributes. No-op when no derived attrs are declared.
   */
  resolveDerivedFields(records: Record<string, unknown>[]): Record<string, unknown>[]
}

/**
 * Create a ModelLayer bound to a specific Model class.
 *
 * The returned object is stateless and may be cached for the lifetime of
 * the process — model configuration is fixed at boot.
 */
export function createModelLayer(model: ModelClassLike): ModelLayer {
  return {
    model,
    resolveDerivedFields(records) {
      return resolveDerivedFieldsImpl(records, model)
    }
  }
}

/**
 * A factory function that resolves a model name (or class) to its bound
 * `ModelLayer`. Injected on `ToolDependencies.modelLayer` and on the app
 * handler context as `context.modelLayer`.
 *
 * The default factory (see `createModelLayerFactory`) looks the name up in
 * the registry it was constructed with and caches the resulting layer per
 * model class. Integrators may supply an alternative factory if they need
 * test substitutions or per-call hooks.
 */
export type ModelLayerFactory = (modelName: string) => ModelLayer

/**
 * Build a `ModelLayerFactory` over a fixed `ModelsRegistry`.
 *
 * The returned factory caches one `ModelLayer` per model class (by identity)
 * so repeated calls within a request are cheap. Throws on unknown model
 * names — there is no fallback to a synthetic empty model.
 */
export function createModelLayerFactory(models: ModelsRegistry): ModelLayerFactory {
  const cache = new WeakMap<ModelClassLike, ModelLayer>()
  return (modelName: string): ModelLayer => {
    const model = models[modelName] as ModelClassLike | undefined
    if (!model) {
      throw new Error(
        `ModelLayer factory: unknown model "${modelName}". ` +
          `Registered: ${Object.keys(models).join(', ') || '(none)'}.`
      )
    }
    const cached = cache.get(model)
    if (cached) return cached
    const layer = createModelLayer(model)
    cache.set(model, layer)
    return layer
  }
}
