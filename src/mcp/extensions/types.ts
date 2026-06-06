/**
 * HttpExtension — opt-in HTTP-layer feature for mcp-rune.
 *
 * Extensions add routes and route-scoped middleware on top of the framework's
 * built-in OAuth, status, and MCP transport endpoints. They are intentionally
 * scoped: they receive a fresh Express Router (mounted at the host's
 * `pathPrefix`) and a narrowed context object — not the raw Express `app`.
 * This prevents extensions from clobbering global error handlers, body
 * parsers, or middleware order.
 *
 * Mount ordering: extensions register **after** the built-in OAuth and status
 * routers but **before** the MCP transport endpoint. They cannot intercept
 * `/mcp` traffic and cannot mask the framework's `/.well-known/*` or
 * `/oauth/*` routes.
 *
 * See `docs/guides/extensions.md` for the authoring guide.
 */

import type { Router } from 'express'

import type { OAuthService } from '#src/oauth2/service.js'
import type * as logger from '#src/runtime/logger.js'

/**
 * Capabilities an extension can require from the host. Validated at boot —
 * a missing capability throws a clear error before the server accepts
 * connections.
 */
export type HttpExtensionCapability = 'oauth'

export interface HttpExtensionContext {
  /** The key the user registered this extension under. Used for log lines. */
  name: string
  /** Pre-created Router instance, mounted at the host's `pathPrefix`. */
  router: Router
  /** Server origin + `pathPrefix`, no trailing slash. */
  baseUrl: string
  /** Path prefix the router is mounted at (empty string or e.g. `/api`). */
  pathPrefix: string
  /** MCP server name, suitable for log lines and metadata fallbacks. */
  mcpName: string
  /**
   * The configured OAuthService, or `null` when the host is in token mode.
   * Extensions that need OAuth should declare `requires: ['oauth']` so the
   * host throws at boot if this would be `null`.
   */
  oauth: OAuthService | null
  /** Shared logger. */
  logger: typeof logger
}

export interface HttpExtension {
  /**
   * Capability requirements asserted at boot. Currently the only capability
   * is `'oauth'` — meaning the host must have an OAuthService configured.
   */
  requires?: HttpExtensionCapability[]
  /**
   * Register routes and middleware on `ctx.router`. The host mounts the
   * router at `ctx.pathPrefix` after this returns.
   */
  register(ctx: HttpExtensionContext): void | Promise<void>
}

/**
 * The user-facing configuration shape. Keys are user-chosen identifiers,
 * used for dedupe (automatic via object semantics) and log lines. Built-in
 * extensions document their conventional key (e.g. `cimd`).
 */
export type HttpExtensionMap = Record<string, HttpExtension>
