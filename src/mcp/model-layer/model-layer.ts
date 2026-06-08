/**
 * ModelLayer — the per-model-bound seam between mcp-rune's projection
 * layer (apps, prompts, tools, ApiExtensions) and the static configuration
 * declared on a Model class.
 *
 *   class Episode extends BaseModel {
 *     static attributes = {
 *       title:      { type: 'belongsTo' },
 *       title_name: { type: 'string', derived: { from: 'title', field: 'name' } },
 *       startedAt:  { type: 'datetime' }
 *     }
 *   }
 *
 *   const epModel = modelLayer('episode')   // bound to Episode at construction
 *
 *   epModel.resolveDerivedFields(records)   // → records with title_name copied out
 *   epModel.kindFor('startedAt')            // → KindDescriptor for datetime
 *   epModel.validFieldNames()               // → Set of legal input keys
 *
 * Every method operates on the model bound at construction; there is no
 * `(modelName, …)` first argument. ModelLayer is purely synchronous — it
 * reads static metadata only and does no I/O. Analysis-domain operations
 * (edges, embeddings, hops, summaries) live on the peer `AnalysisLayer`.
 *
 * Consumers (apps, prompts, tools) receive a `ModelLayerFactory` via
 * `context.modelLayer` / `ToolDependencies.modelLayer` and call it with a
 * model name to get a bound layer. Never import the underlying helpers
 * (`resolveDerivedFields`, `collectValidFieldNames`, `getKind`) directly.
 */

import { getKind, type KindDescriptor } from '#src/mcp/models/kinds/index.js'
import type { ModelsRegistry } from '#src/mcp/models/model-definitions.js'
import type { ModelClassLike } from '#src/mcp/schema/types.js'

import { resolveDerivedFields as resolveDerivedFieldsImpl } from './derived-fields.js'
import { collectValidFieldNames } from './field-names.js'
import {
  type DerivationModelConfig,
  type DerivedSchema,
  derivePromptSchema as derivePromptSchemaImpl,
  type DeriveSchemaOptions
} from './schema-derivation.js'
import { validateRequired, type ValidationResult } from './validators.js'

export interface ModelLayer {
  /** The Model class this layer is bound to. */
  readonly model: ModelClassLike

  /**
   * Resolve the `KindDescriptor` for `attrName` on the bound model, using
   * the attribute's declared `type` and `format`. Throws if the attribute
   * is unknown or the kind/format pair isn't registered.
   */
  kindFor(attrName: string): KindDescriptor

  /**
   * Flatten nested association data into top-level fields, in place, on a
   * list of records. Driven by `derived: { from, field }` declarations on
   * the bound model's attributes. No-op when no derived attrs are declared.
   */
  resolveDerivedFields(records: Record<string, unknown>[]): Record<string, unknown>[]

  /**
   * Set of every legal form/prompt input key for the bound model:
   *   - every attribute name
   *   - `<rel>_id` and `<rel>_link` for each `belongsTo` association
   *   - `<rel>`, `<rel>_ids`, `<rel>_links`, plus `<target_model>_ids`
   *     and `<target_model>_links` for each `hasMany` association.
   */
  validFieldNames(): Set<string>

  /**
   * Derive the prompt schema (field definitions + groups) for the bound
   * model. Wraps `derivePromptSchema` — internally memoized, so repeated
   * calls with the same options are cheap.
   */
  promptSchema(options?: DeriveSchemaOptions): DerivedSchema

  /**
   * Check that every required attribute on the bound model is present in
   * `params`. Returns `{ valid, missing: string[] }`. Required fields come
   * from the model's `static required` (`BaseModel` derives this from
   * `attributes`).
   */
  checkRequired(params: Record<string, unknown>): ValidationResult
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
    kindFor(attrName) {
      const attr = model.attributes?.[attrName]
      if (!attr) {
        throw new Error(`ModelLayer.kindFor: attribute "${attrName}" not found on bound model.`)
      }
      return getKind(attr.type, attr.format)
    },
    resolveDerivedFields(records) {
      return resolveDerivedFieldsImpl(records, model)
    },
    validFieldNames() {
      return collectValidFieldNames(model)
    },
    promptSchema(options) {
      // ModelClassLike is the loose schema-validator type; the bound model is
      // really a ModelConfig from the registry. Cast at the layer boundary so
      // schema derivation sees the fields it needs (associations, required).
      return derivePromptSchemaImpl(model as unknown as DerivationModelConfig, options)
    },
    checkRequired(params) {
      const required = (model as ModelClassLike & { required?: readonly string[] }).required ?? []
      return validateRequired(params, [...required])
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
