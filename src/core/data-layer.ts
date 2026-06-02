/**
 * DataLayer — the stable seam between mcp-rune's projection layer
 * (tools, prompts, apps, domain) and any concrete API-backed data source.
 *
 * The projection layer is what makes mcp-rune unique: polymorphic CRUD
 * tools, prompt-strategy generation, schema-driven MCP apps, domain
 * workflow registries. None of that needs to know whether records come
 * from axios, fetch, a JSON:API store, an in-memory fixture, or a future
 * library adapter. It only needs the operations declared here.
 *
 * The default adapter is `ModelService` (composing `ApiClient`,
 * `EndpointResolver`, and a `BaseConvention`). Alternative adapters —
 * e.g. an in-memory stub for offline tool tests, or a third-party
 * library wrapper shipped as a separate package — implement this same
 * surface and slot in via the `dataLayer` factory option on
 * `ToolRegistry` and `AppRegistry`.
 *
 * Design constraints:
 *   - Returns raw API responses; no MCP framing here.
 *   - Throws domain errors; tools/apps catch and format for MCP.
 *   - Has no knowledge of the MCP protocol (no ToolResult, no content arrays).
 *   - The interface is the contract: do not add methods adapters cannot
 *     reasonably implement. Escape hatches live behind `dispatch`.
 */

import type { NormalizedListResponse } from '#src/api-extensions/search/types.js'
import type { EndpointResolver } from '#src/mcp/services/endpoint-resolver.js'
import type { ModelRequestOptions, PaginationParams } from '#src/mcp/services/model-service.js'
// These types describe the contract surface; they live in non-core modules
// today, but the interface they describe is core. Re-exported below so
// consumers import everything DataLayer-related from one place.
import type { ModelConfig, ModelsRegistry, ToolLogger } from '#src/mcp/tools/base-tool.js'

import type { ApiClient, RequestOptions } from './api-client.js'

export type {
  EndpointResolver,
  ModelConfig,
  ModelRequestOptions,
  ModelsRegistry,
  NormalizedListResponse,
  PaginationParams,
  RequestOptions
}

/**
 * The projection-facing data-access surface.
 *
 * Every method returns plain `Record<string, unknown>` — adapters are
 * responsible for their own response normalization upstream of this
 * boundary (typically inside a `Convention`). The projection layer
 * treats responses as opaque payloads keyed by API conventions.
 */
export interface DataLayer {
  /**
   * Create a record. Adapters must validate required fields and apply
   * the model's convention before dispatching.
   */
  create(
    model: string,
    attributes: Record<string, unknown>,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>>

  /** Fetch a single record by ID. Compound IDs (e.g. `titles/42/assets/7`) are supported. */
  find(model: string, recordId: string, options?: RequestOptions): Promise<Record<string, unknown>>

  /**
   * List records with optional filters and pagination. `parentPath` on
   * `ModelRequestOptions` selects nested-resource collections.
   */
  list(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<Record<string, unknown>>

  /**
   * List records and return a convention-normalized `{ records, pagination }`
   * envelope. Adapters apply the model's convention internally so callers
   * (notably MCP apps) never need to reach for `defaultConvention` themselves.
   *
   * The seam-level normalization point. Prefer this over `list()` whenever
   * the caller wants flat records and pagination metadata without taking on
   * convention awareness.
   */
  listNormalized(
    model: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse>

  /**
   * Search records by optional text `query` and/or structured `filters`,
   * returning the same normalized envelope as `listNormalized`. The single
   * projection-facing entry point for "find me records" — adapters decide
   * internally whether to delegate to a search endpoint, fall back to list,
   * or route nested-only models through an alternate path.
   *
   * Apps that previously composed `SearchService` directly use this method
   * so the projection layer never imports a concrete search adapter.
   *
   * Default-adapter behavior: if no search backend is wired, an adapter may
   * ignore `query` and delegate to `listNormalized`. The `NormalizedListResponse`
   * shape is the contract; routing details are an adapter concern.
   */
  searchNormalized(
    model: string,
    query?: string,
    filters?: Record<string, unknown>,
    pagination?: PaginationParams,
    options?: ModelRequestOptions
  ): Promise<NormalizedListResponse>

  /** Partial update of an existing record. Compound IDs supported. */
  update(
    model: string,
    recordId: string,
    attributes: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>

  /** Delete a record. Compound IDs supported. */
  delete(
    model: string,
    recordId: string,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>

  /**
   * Raw HTTP dispatch for non-CRUD verbs and custom endpoints.
   *
   * Used by the `custom-actions` ApiExtension and by apps that need
   * the underlying transport without going through CRUD semantics.
   * Adapters that do not back onto HTTP may throw for unsupported
   * methods or URLs.
   */
  dispatch(
    method: string,
    url: string,
    payload?: Record<string, unknown>,
    params?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>>

  /**
   * Build a request payload through the model's convention. Public so
   * extensions (e.g. custom-actions) can reuse the same payload-wrapping
   * and association-resolution pipeline as core CRUD before calling
   * `dispatch`.
   */
  buildPayload(
    model: string,
    modelConfig: ModelConfig,
    attrs: Record<string, unknown>
  ): Record<string, unknown>

  /** Read-only view of the models registry the adapter was constructed with. */
  readonly models: ModelsRegistry

  /**
   * Underlying endpoint resolver.
   *
   * Exposed for ApiExtensions (custom-actions) that compose
   * `pathForType()` and `applyNamespace()` to resolve their own URLs.
   * Marked unstable: alternative adapters (e.g. a Zodios-backed one) may
   * not have an `EndpointResolver` at all. Extensions that reach for
   * this opt out of cross-adapter portability.
   */
  readonly endpointResolver: EndpointResolver
}

/**
 * Factory that produces a `DataLayer` from per-request authenticated
 * context. `ToolRegistry` and `AppRegistry` call this once per
 * tool/app invocation (or per session, depending on integrator wiring).
 *
 * The default factory wraps `ModelService`. Integrators that want a
 * different transport (in-memory stub, Zodios, fetch-only, etc.)
 * provide their own.
 */
export interface DataLayerFactoryContext {
  /**
   * The authenticated low-level API client, if the host adapter uses
   * one. The default `ModelService` adapter requires this. Adapters
   * that don't speak HTTP can ignore it.
   */
  apiClient?: ApiClient
  models: ModelsRegistry
  namespace?: string
  logger?: ToolLogger
}

export type DataLayerFactory = (ctx: DataLayerFactoryContext) => DataLayer
