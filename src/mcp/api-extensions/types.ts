/**
 * ApiExtension — opt-in model/API-layer feature for mcp-rune.
 *
 * Extensions contribute MCP tools and ModelService methods on top of the
 * framework's built-in CRUD pipeline. They are the model-layer parallel of
 * `HttpExtension`: same authoring contract (`requires`, `register(ctx)`,
 * narrowed context, explicit opt-in, capability validation at boot), but
 * scoped to the tool registry rather than the HTTP transport. That makes
 * them work uniformly in stdio mode where `HttpServer` doesn't exist.
 *
 * Registration lifetime: per-ToolRegistry. An ApiExtension runs **if and
 * only if** you pass it in the `apiExtensions` option on `ToolRegistry`.
 *
 * The context object exposes narrowed *collectors* (`registerTool`,
 * `registerModelServiceMixin`) — not raw access to the registry internals.
 * Extensions can break their own contributions, but they cannot reach into
 * the host.
 *
 * See `docs/guides/api-extensions.md` for the authoring guide.
 */

import type { SummaryStrategy } from '#src/mcp/models/summary-strategies/index.js'
import type * as logger from '#src/services/logger.js'

import type { ModelService } from '../data-layer/model-service/model-service.js'
import type { ModelsRegistry, ServerContext } from '../tools/base-tool.js'
import type { ToolClass } from '../tools/tool-registry.js'

export type { SummaryStrategy }

/**
 * Capabilities an extension can require from the host. Validated at boot —
 * a missing capability throws a clear error before the registry accepts
 * tool registrations.
 *
 * Reserved for future capabilities; none are defined yet. Declaring the type
 * now keeps the registration contract identical to `HttpExtension` so the
 * two pattern docs stay aligned.
 */
export type ApiExtensionCapability = never

/**
 * Augments a `ModelService` instance with additional methods. Called once
 * per service instance (lazily, when a tool first accesses `modelService`).
 *
 * Return a map of method names to functions; the host assigns each entry
 * onto the service via `Object.assign`. Mixin authors should use the passed
 * service for shared building blocks (`buildPayload`, `dispatch`,
 * `endpointResolver`) rather than reaching into private internals.
 *
 * Mixin method names must be globally unique across all registered
 * extensions; collisions throw at boot.
 */
export type ModelServiceMixin = (
  service: ModelService
) => Record<string, (...args: unknown[]) => unknown>

export interface ApiExtensionContext {
  /** The key the user registered this extension under. Used for log lines. */
  name: string
  /** Read-only view of the models registry. */
  models: ModelsRegistry
  /** Server context (name, description, etc.). */
  serverContext: ServerContext
  /** Shared logger. */
  logger: typeof logger
  /**
   * Contribute an MCP tool. Tool names must be globally unique across core
   * tools and all extensions; duplicates throw at boot with both extension
   * keys in the message.
   */
  registerTool(name: string, ToolClass: ToolClass): void
  /**
   * Contribute a method-extension to `ModelService`. Mixin methods become
   * callable on the instance via `tool.modelService.<methodName>(...)`.
   */
  registerModelServiceMixin(mixin: ModelServiceMixin): void
  /**
   * Contribute a summary strategy usable by `analysis_ingest` (via the
   * `summary_strategy` / `summary_strategies` params) and `analysis_summarize`.
   * Strategy names must be globally unique across built-ins and all
   * extensions; collisions throw at boot with both owner keys in the
   * message. See `docs/guides/summary-strategies.md` for the authoring guide.
   */
  registerSummaryStrategy(strategy: SummaryStrategy): void
}

export interface ApiExtension {
  /**
   * Capability requirements asserted at boot. Reserved — no capabilities
   * are defined yet.
   */
  requires?: ApiExtensionCapability[]
  /**
   * Register tools and mixins on the host-provided collectors. Called once
   * at `ToolRegistry` construction.
   */
  register(ctx: ApiExtensionContext): void
}

/**
 * The user-facing configuration shape. Keys are user-chosen identifiers,
 * used for dedupe (automatic via object semantics) and log lines. Built-in
 * extensions document their conventional key.
 */
export type ApiExtensionMap = Record<string, ApiExtension>
