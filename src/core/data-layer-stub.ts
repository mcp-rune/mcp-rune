/**
 * InMemoryDataLayer — reference `DataLayer` adapter backed by Maps.
 *
 * Purpose:
 *   - Prove the `DataLayer` interface is honest. If a tool, app, or
 *     extension reaches behind the interface for something this stub
 *     can't provide, the gap surfaces as a runtime failure here rather
 *     than as an unstated dependency on the default `ModelService` +
 *     `ApiClient` adapter.
 *   - Power offline tests for the polymorphic tools and prompt-driven
 *     workflows without standing up an HTTP backend.
 *   - Document the shape any future library-backed adapter
 *     (`@mcp-rune/data-layer-zodios`, fetch-only, etc.) must implement.
 *
 * What it is *not*:
 *   - A general-purpose mock database. There is no SQL, no transactions,
 *     no relational integrity, no querying beyond exact-match filters.
 *     If you need those, write a real adapter — that is the point of
 *     the seam.
 *   - A drop-in replacement for `ModelService` in production. The
 *     fixtures live in process memory and disappear with the process.
 *
 * The stub follows the same `belongsTo`-via-`{rel}_id` flat convention
 * the default JSON:API convention uses, so association attributes
 * round-trip without convention-specific decoration. Adapters needing
 * HAL or another convention should mimic the real `ModelService`
 * (delegating to the model's convention) — the stub deliberately stays
 * convention-free so the seam is the only thing under test.
 */

import { EndpointResolver } from '#src/mcp/services/endpoint-resolver.js'

import type { ApiClient, RequestOptions } from './api-client.js'
import type {
  DataLayer,
  ModelConfig,
  ModelRequestOptions,
  ModelsRegistry,
  NormalizedListResponse,
  PaginationParams
} from './data-layer.js'

/** Record-shaped fixture; mirrors what the projection layer expects to read back. */
export type StubRecord = Record<string, unknown>

/** Pre-seeded fixtures keyed by model name → id → record. */
export type StubFixtures = Record<string, Record<string, StubRecord>>

export interface InMemoryDataLayerOptions {
  models: ModelsRegistry
  /**
   * Pre-seeded data. The outer key is the model name; the inner key is
   * the record id. The values are returned as-is from `find`/`list`.
   */
  fixtures?: StubFixtures
  /** ID generator. Defaults to a monotonically increasing counter per model. */
  idGenerator?: (model: string) => string | number
}

/**
 * `DataLayer` adapter that serves records from in-process Maps. Suitable
 * for tests, offline LLM evals, and demonstrating that the projection
 * layer doesn't depend on HTTP behind the seam.
 */
export class InMemoryDataLayer implements DataLayer {
  readonly models: ModelsRegistry
  readonly endpointResolver: EndpointResolver

  private _store: Map<string, Map<string, StubRecord>>
  private _counters: Map<string, number> = new Map()
  private _idGenerator: (model: string) => string | number

  constructor({ models, fixtures = {}, idGenerator }: InMemoryDataLayerOptions) {
    this.models = models
    this.endpointResolver = new EndpointResolver()
    this._store = new Map()
    for (const [model, recordsByID] of Object.entries(fixtures)) {
      const bucket = new Map<string, StubRecord>()
      for (const [id, record] of Object.entries(recordsByID)) {
        bucket.set(String(id), record)
      }
      this._store.set(model, bucket)
    }
    this._idGenerator =
      idGenerator ??
      ((model: string) => {
        const next = (this._counters.get(model) ?? 0) + 1
        this._counters.set(model, next)
        return next
      })
  }

  async create(
    model: string,
    attributes: Record<string, unknown>,
    _options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._requireModel(model)
    this._assertWritable(model, modelConfig)
    this._assertRequired(model, modelConfig, attributes)

    const id = (attributes.id as string | number | undefined) ?? this._idGenerator(model)
    const record: StubRecord = { id, ...attributes }
    this._bucket(model).set(String(id), record)
    return record
  }

  async find(
    model: string,
    recordId: string,
    _options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    this._requireModel(model)
    const record = this._bucket(model).get(recordId)
    if (!record) {
      throw new Error(`Record not found: ${model}/${recordId}`)
    }
    return record
  }

  async list(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    _options?: ModelRequestOptions
  ): Promise<Record<string, unknown>> {
    this._requireModel(model)
    let records = Array.from(this._bucket(model).values())
    if (filters) {
      records = records.filter((r) =>
        Object.entries(filters).every(([k, v]) => v === undefined || r[k] === v)
      )
    }
    const page = pagination?.page ?? 1
    const perPage = pagination?.perPage ?? 20
    const start = (page - 1) * perPage
    const paged = records.slice(start, start + perPage)
    return {
      records: paged,
      pagination: {
        page,
        per_page: perPage,
        total: records.length,
        total_pages: Math.max(1, Math.ceil(records.length / perPage))
      }
    }
  }

  /**
   * The stub's `list()` already returns the normalized shape (fixtures are
   * canonical), so `listNormalized` reuses it and reshapes the envelope.
   */
  async listNormalized(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse> {
    const raw = await this.list(model, filters, pagination, options)
    return {
      records: (raw.records as Record<string, unknown>[]) ?? [],
      pagination: raw.pagination as NormalizedListResponse['pagination']
    }
  }

  async update(
    model: string,
    recordId: string,
    attributes: Record<string, unknown>,
    _options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._requireModel(model)
    this._assertWritable(model, modelConfig)
    const bucket = this._bucket(model)
    const existing = bucket.get(recordId)
    if (!existing) {
      throw new Error(`Record not found: ${model}/${recordId}`)
    }
    const merged = { ...existing, ...attributes, id: existing.id }
    bucket.set(recordId, merged)
    return merged
  }

  async delete(
    model: string,
    recordId: string,
    _options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    const modelConfig = this._requireModel(model)
    this._assertWritable(model, modelConfig)
    const bucket = this._bucket(model)
    if (!bucket.has(recordId)) {
      throw new Error(`Record not found: ${model}/${recordId}`)
    }
    bucket.delete(recordId)
    return { id: recordId, deleted: true }
  }

  /**
   * Raw URL dispatch is not meaningful for an in-memory adapter. The
   * stub treats it as a no-op that returns `{}` so tests can pass it
   * around without crashing, but any test that actually relies on
   * dispatch semantics should use the default `ModelService` adapter.
   */
  async dispatch(): Promise<Record<string, unknown>> {
    return {}
  }

  /**
   * The default convention pipeline wraps attributes as `{ [singular]: attrs }`.
   * The stub mimics that minimally so callers exercising `buildPayload`
   * receive an envelope of the same shape; HAL-style association
   * resolution is intentionally absent — see the class docblock.
   */
  buildPayload(
    _model: string,
    modelConfig: ModelConfig,
    attrs: Record<string, unknown>
  ): Record<string, unknown> {
    const singular = this._singularName(modelConfig)
    return { [singular]: attrs }
  }

  // --- Test helpers ---

  /** Direct access to a model's bucket for fixture inspection in tests. */
  recordsFor(model: string): StubRecord[] {
    return Array.from(this._bucket(model).values())
  }

  /** Reset all fixtures and the id counter. */
  reset(): void {
    this._store.clear()
    this._counters.clear()
  }

  // --- Internals ---

  private _bucket(model: string): Map<string, StubRecord> {
    let bucket = this._store.get(model)
    if (!bucket) {
      bucket = new Map()
      this._store.set(model, bucket)
    }
    return bucket
  }

  private _requireModel(model: string): ModelConfig {
    const cfg = this.models[model]
    if (!cfg) {
      throw new Error(
        `Unknown model: ${model}. Available models: ${Object.keys(this.models).join(', ')}`
      )
    }
    return cfg
  }

  private _assertWritable(model: string, modelConfig: ModelConfig): void {
    if (modelConfig.api?.readOnly) {
      throw new Error(`The '${model}' model is read-only and cannot be modified.`)
    }
  }

  private _assertRequired(
    model: string,
    modelConfig: ModelConfig,
    attributes: Record<string, unknown>
  ): void {
    const required = (modelConfig as Record<string, unknown>).required as string[] | undefined
    if (!required?.length) return
    const missing = required.filter((field) => attributes[field] === undefined)
    if (missing.length) {
      throw new Error(`Missing required fields on ${model}: ${missing.join(', ')}`)
    }
  }

  private _singularName(modelConfig: ModelConfig): string {
    const endpoint = modelConfig.api?.endpoint ?? ''
    return (
      ((modelConfig as Record<string, unknown>).singularName as string | undefined) ??
      endpoint.replace(/s$/, '')
    )
  }
}

/**
 * Convenience factory matching the `DataLayerFactory` signature so the
 * stub can slot into `ToolRegistry`/`AppRegistry` directly:
 *
 *   new ToolRegistry({ dataLayer: createInMemoryDataLayer({ fixtures }), ... })
 *
 * `apiClient` is ignored — the stub has no HTTP transport.
 */
export function createInMemoryDataLayer(
  options: Omit<InMemoryDataLayerOptions, 'models'> = {}
): (ctx: { apiClient?: ApiClient; models: ModelsRegistry }) => DataLayer {
  return (ctx) => new InMemoryDataLayer({ models: ctx.models, ...options })
}
