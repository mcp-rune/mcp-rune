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

import { readFileSync } from 'node:fs'

import { EndpointResolver } from '#src/mcp/data-layer/model-service/endpoint-resolver.js'

import type { ApiClient, RequestOptions } from '../../core/api-client.js'
import { jsonApiConvention } from './api-conventions/index.js'
import type {
  BaseConvention,
  DataLayer,
  FilterValidationResult,
  ModelConfig,
  ModelRequestOptions,
  ModelsRegistry,
  NestedValidationResult,
  NormalizedListResponse,
  PaginationParams
} from './data-layer.js'
import {
  checkFiltersAgainstAttributes,
  checkLinkAgainstAssociations,
  normalizeFiltersAgainstAttributes,
  resolveFilterableAttributes
} from './request-validators.js'

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
  /**
   * Wire-format default reported via `defaultConvention`. The stub itself
   * does not use a convention internally; this only satisfies the
   * `DataLayer` contract so projection-layer consumers that read
   * `dataLayer.defaultConvention` see a non-null value.
   */
  defaultConvention?: BaseConvention
}

/**
 * `DataLayer` adapter that serves records from in-process Maps. Suitable
 * for tests, offline LLM evals, and demonstrating that the projection
 * layer doesn't depend on HTTP behind the seam.
 */
export class InMemoryDataLayer implements DataLayer {
  readonly models: ModelsRegistry
  readonly endpointResolver: EndpointResolver
  readonly defaultConvention: BaseConvention

  private _store: Map<string, Map<string, StubRecord>>
  private _counters: Map<string, number> = new Map()
  private _idGenerator: (model: string) => string | number

  constructor({ models, fixtures = {}, idGenerator, defaultConvention }: InMemoryDataLayerOptions) {
    this.models = models
    this.endpointResolver = new EndpointResolver()
    this.defaultConvention = defaultConvention ?? jsonApiConvention
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

  /**
   * The in-memory stub has no text-search backend; `query` is ignored and
   * the call delegates to `listNormalized`. Tests that need to exercise
   * search-routing logic should wrap this adapter in `SearchEnabledDataLayer`.
   */
  async searchNormalized(
    model: string,
    _query?: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse> {
    return this.listNormalized(model, filters, pagination, options)
  }

  /**
   * Typeahead in the stub is a plain page from the model's bucket. The
   * `query` arg is ignored — tests should seed fixtures so the first page
   * contains the records the picker expects to see.
   */
  async lookupNormalized(
    model: string,
    _query: string,
    options?: { perPage?: number }
  ): Promise<NormalizedListResponse> {
    return this.listNormalized(model, undefined, { page: 1, perPage: options?.perPage ?? 10 })
  }

  /**
   * Group search requires the search ApiExtension and search-group
   * configuration. The stub has neither — throws so tests reaching for
   * group search fail loudly rather than silently returning empty.
   */
  async groupSearchNormalized(
    _group: string,
    _query: string,
    _options?: { perPage?: number; models?: string[] }
  ): Promise<NormalizedListResponse> {
    throw new Error(
      'Group search requires the search ApiExtension and is not supported by InMemoryDataLayer.'
    )
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
   * Read-side dispatch is implemented so `analysis_ingest` (which uses
   * `dispatch('GET', endpoint, …, { page, per_page })` for unfiltered
   * pagination) works against the stub. The returned envelope mirrors
   * what the default JSON:API convention expects from a real backend:
   * `{ data: [...records], meta: { page, per_page, total, total_pages } }`.
   *
   * Writes (POST/PATCH/PUT/DELETE) and unknown URLs fall through to `{}`.
   * The typed `create`/`update`/`delete` methods are the canonical write
   * path; tests that need to exercise non-CRUD verbs should use the
   * default `ModelService` adapter.
   */
  async dispatch(
    method: string,
    url: string,
    _payload?: Record<string, unknown>,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (method?.toUpperCase() !== 'GET') return {}

    const modelName = this._modelByEndpoint(url)
    if (!modelName) return {}

    const page = Number(params?.page ?? 1) || 1
    const perPage = Number(params?.per_page ?? params?.perPage ?? 20) || 20
    const result = await this.listNormalized(modelName, undefined, { page, perPage })

    return {
      data: result.records,
      meta: result.pagination
    }
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

  validateFilters(
    model: string,
    filters: Record<string, unknown> | undefined
  ): FilterValidationResult {
    return checkFiltersAgainstAttributes(model, filters, this.models)
  }

  normalizeFilters(
    model: string,
    filters: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    return normalizeFiltersAgainstAttributes(
      filters,
      resolveFilterableAttributes(model, this.models)
    )
  }

  validateNestedResource(parentModel: string, childResource: string): NestedValidationResult {
    return checkLinkAgainstAssociations(parentModel, childResource, this.models)
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

  /** Resolve a model name from its `api.endpoint`, for `dispatch('GET', url, …)`. */
  private _modelByEndpoint(endpoint: string): string | null {
    for (const [name, cfg] of Object.entries(this.models)) {
      if (cfg.api?.endpoint === endpoint) return name
    }
    return null
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
    const required = modelConfig.required
    if (!required?.length) return
    const missing = required.filter((field) => attributes[field] === undefined)
    if (missing.length) {
      throw new Error(`Missing required fields on ${model}: ${missing.join(', ')}`)
    }
  }

  private _singularName(modelConfig: ModelConfig): string {
    const endpoint = modelConfig.api?.endpoint ?? ''
    return modelConfig.singularName ?? endpoint.replace(/s$/, '')
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

/**
 * Read a JSON file into the `StubFixtures` shape used by
 * `createInMemoryDataLayer({ fixtures })`. Two input shapes are accepted:
 *
 *   1. Object-keyed: `{ <model>: { <id>: record, … } }` — returned as-is.
 *   2. Array-keyed:  `{ <model>: [record, …] }` — each `record.id` becomes
 *      the inner key. Throws if any record is missing `id`.
 *
 * Designed for demo datasets (e.g. a checked-in `books.5000.json`) where
 * hand-writing the nested object is awkward. The framework reads the
 * file synchronously and does no validation beyond shape — record fields
 * are passed through opaquely.
 */
export function loadFixturesFromJson(path: string): StubFixtures {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`loadFixturesFromJson: cannot read ${path}: ${(err as Error).message}`, {
      cause: err
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`loadFixturesFromJson: invalid JSON in ${path}: ${(err as Error).message}`, {
      cause: err
    })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `loadFixturesFromJson: expected top-level object keyed by model name in ${path}`
    )
  }

  const fixtures: StubFixtures = {}
  for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const bucket: Record<string, StubRecord> = {}
      for (const [i, record] of value.entries()) {
        if (!record || typeof record !== 'object') {
          throw new Error(`loadFixturesFromJson: ${path} → ${model}[${i}] is not an object`)
        }
        const id = (record as StubRecord).id
        if (id === undefined || id === null) {
          throw new Error(
            `loadFixturesFromJson: ${path} → ${model}[${i}] is missing required \`id\` field`
          )
        }
        bucket[String(id)] = record as StubRecord
      }
      fixtures[model] = bucket
    } else if (value && typeof value === 'object') {
      fixtures[model] = value as Record<string, StubRecord>
    } else {
      throw new Error(
        `loadFixturesFromJson: ${path} → ${model} must be an object or array of records`
      )
    }
  }

  return fixtures
}
