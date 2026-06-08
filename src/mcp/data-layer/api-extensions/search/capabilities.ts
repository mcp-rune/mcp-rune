/**
 * Search capability readers — the single typed access layer for every
 * consumer (the extension itself, MCP apps, analysis-ingest, list-models,
 * validators) that needs to interrogate a model's search configuration.
 *
 * Centralizing these reads means the per-model config slot can move
 * (e.g., from `static search` on `BaseModel` to `extensions['search']`
 * in a future release) by changing only `getSearchConfig()` — every
 * consumer above it already routes through this module.
 */

import type { ModelsRegistry } from '#src/mcp/models/model-definitions.js'

import type { SearchConfig } from './types.js'

/**
 * Minimal structural shape every search config carrier matches.
 *
 * Both `ModelConfig` (used by tools/services) and `AppModelClass` (used by
 * MCP apps) qualify, so the capability readers work uniformly across the
 * three consumer clusters without forcing the call sites to cast.
 */
export interface ModelWithExtensions {
  extensions?: Record<string, unknown>
}

/**
 * Typed helper for declaring this extension's per-model slice. Use it —
 * not a raw object literal — so TypeScript catches mistakes at the call
 * site even though the `extensions` bag is `Record<string, unknown>`.
 *
 * ```ts
 * static extensions = {
 *   search: searchConfig({
 *     lookup: { fields: ['title'] },
 *     filters: { status: { type: 'enum', enumValues: ['draft', 'live'] } }
 *   })
 * }
 * ```
 */
export function searchConfig(config: SearchConfig): SearchConfig {
  return config
}

/**
 * Read a model's search configuration from its `extensions['search']` slice.
 * Returns `undefined` when the model doesn't opt into search, so callers
 * can tolerate the absence without conditionals.
 *
 * Symmetrical with `getActionsConfig()` from the `custom-actions` extension.
 */
export function getSearchConfig(model: ModelWithExtensions): SearchConfig | undefined {
  return model.extensions?.['search'] as SearchConfig | undefined
}

/** A model's filter schema, or `undefined` when none is declared. */
export function getModelFilters(model: ModelWithExtensions): Record<string, unknown> | undefined {
  return getSearchConfig(model)?.filters
}

/** Names of models that declare at least one search filter. */
export function getSearchableModelNames(models: ModelsRegistry): string[] {
  return Object.entries(models)
    .filter(([, m]) => {
      const filters = getSearchConfig(m)?.filters
      return filters && Object.keys(filters).length > 0
    })
    .map(([name]) => name)
}

/** Names of models that declare at least one lookup field. */
export function getLookupableModelNames(models: ModelsRegistry): string[] {
  return Object.entries(models)
    .filter(([, m]) => {
      const fields = getSearchConfig(m)?.lookup?.fields
      return fields && fields.length > 0
    })
    .map(([name]) => name)
}

/** Names of models that declare a full-text query endpoint (direct or group). */
export function getQueryableModelNames(models: ModelsRegistry): string[] {
  return Object.entries(models)
    .filter(([, m]) => !!getSearchConfig(m)?.query)
    .map(([name]) => name)
}
