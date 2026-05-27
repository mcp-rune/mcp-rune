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

import type { ModelConfig, ModelsRegistry } from '#src/mcp/tools/base-tool.js'

import type { SearchConfig } from './types.js'

/**
 * Read a model's search configuration. Returns `undefined` when the model
 * doesn't declare search, so callers can tolerate the absence without
 * conditionals.
 *
 * Symmetrical with `getActionsConfig()` from the `custom-actions` extension.
 */
export function getSearchConfig(model: ModelConfig): SearchConfig | undefined {
  return (model.search ?? undefined) as SearchConfig | undefined
}

/** A model's filter schema, or `undefined` when none is declared. */
export function getModelFilters(model: ModelConfig): Record<string, unknown> | undefined {
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
