/**
 * ToolFlowExtension — opt-in tool-layer feature for mcp-rune.
 *
 * Sibling to `HttpExtension`. Where HTTP extensions add routes + middleware,
 * tool-flow extensions modify the MCP tool surface and the runtime context
 * threaded into app tool handlers. Typical uses:
 *
 *   - Register additional MCP App tools (e.g. helpers tied to an integration).
 *   - Flip the create/update form `submitMode` from `'direct'` (default) to
 *     `'collect'` (Center-of-Control review pattern).
 *   - Provide shared per-server state (e.g. a `FormDataStore`) that other
 *     tool handlers read from their context.
 *
 * Like `HttpExtension`, extensions are opt-in and keyed by a user-chosen
 * name (used for log lines and dedupe). If no tool-flow extension registers,
 * the framework default applies: `submitMode: 'direct'` and no extra tools.
 *
 * Mount ordering: tool-flow extensions run **before** app tools are
 * registered on the McpServer. Registration is synchronous from the server
 * factory's point of view (Promises are awaited).
 *
 * See `docs/guides/extensions.md` for the authoring guide.
 */

import type * as logger from '#src/runtime/logger.js'

import type { AppDefinition } from '../apps/lib/registry.js'

/**
 * Capabilities a tool-flow extension can require from the host. Validated at
 * boot — a missing capability throws a clear error before the server accepts
 * connections.
 *
 * - `'apps'`: the host must have configured an `AppRegistry`. Extensions that
 *   register app tools or flip the form submit mode need this.
 */
export type ToolFlowExtensionCapability = 'apps'

/** Form submission mode advertised in `new_model_app` / `edit_model_app` responses. */
export type FormSubmitMode = 'direct' | 'collect'

/**
 * Typed handle for a value threaded into the app-tool context bag. Define
 * once per producer, share with consumers as a typed import. The `name`
 * becomes the property key in the runtime context object; two keys with the
 * same `name` will collide at `provideContext` time.
 *
 * The phantom `__type` field is type-only and never assigned at runtime —
 * it's what lets `provideContext<T>(key: ContextKey<T>, value: T)` enforce
 * that the value's type matches what the key was declared with.
 */
export interface ContextKey<T> {
  readonly name: string
  /** @internal Phantom type marker; never read at runtime. */
  readonly __type?: T
}

/**
 * Define a typed context key. Use the returned key with
 * `ToolFlowExtensionContext.provideContext(key, value)`.
 *
 * Producers typically `export const MY_KEY = defineContextKey<MyType>('myKey')`
 * so consumer modules can import the key and read `context[MY_KEY.name]` (or
 * a typed accessor built on top) without re-declaring the property name as
 * a string literal.
 */
export function defineContextKey<T>(name: string): ContextKey<T> {
  return { name }
}

export interface ToolFlowExtensionContext {
  /** Key the user registered this extension under. Used for log lines. */
  name: string
  /** MCP server name, suitable for log lines and metadata fallbacks. */
  mcpName: string
  /**
   * Register an additional app tool (same shape as anything already in the
   * `AppRegistry`). Useful for extension-owned tools like
   * `collect_form_data` / `get_form_data`.
   */
  registerTool(app: AppDefinition): void
  /**
   * Look up an already-registered app by tool name. Useful when an extension
   * needs to derive metadata from a built-in app (e.g. cloning the
   * `new_model_app` app's `resourceUri` and `getHtml`).
   *
   * Returns `undefined` if no app with that tool name is registered.
   */
  getApp(toolName: string): AppDefinition | undefined
  /**
   * Override the form submit mode threaded into every `new_model_app`
   * and `edit_model_app` response. Default: `'direct'`.
   */
  setFormSubmitMode(mode: FormSubmitMode): void
  /**
   * Inject a typed value into the shared context object passed to every app
   * tool handler. Use this to thread extension-owned state (e.g. a
   * `FormDataStore`) into handlers without coupling them to the extension
   * itself.
   *
   * The `key` is a `ContextKey<T>` produced by `defineContextKey<T>(name)`;
   * the value's type must match the key's declared type. Two extensions that
   * provide keys with the same `name` fail fast at registration with both
   * contributor keys in the error message.
   */
  provideContext<T>(key: ContextKey<T>, value: T): void
  /** Shared logger. */
  logger: typeof logger
}

export interface ToolFlowExtension {
  /**
   * Capability requirements asserted at boot. Currently the only capability
   * is `'apps'` — meaning the host must have an `AppRegistry` configured.
   */
  requires?: ToolFlowExtensionCapability[]
  /**
   * Apply the extension to the host. Called once at MCP server creation,
   * before app tools are registered on the underlying `McpServer`.
   */
  register(ctx: ToolFlowExtensionContext): void | Promise<void>
}

/**
 * The user-facing configuration shape. Keys are user-chosen identifiers,
 * used for dedupe (automatic via object semantics) and log lines. Built-in
 * extensions document their conventional key (e.g. `centerOfControl`).
 */
export type ToolFlowExtensionMap = Record<string, ToolFlowExtension>
