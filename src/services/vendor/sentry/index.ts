/**
 * Sentry Error Tracking Vendor Implementation
 *
 * Provides Sentry-specific initialization and configuration.
 * This module should only be imported by lib/services/error-tracking.js
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/node/
 */

import * as Sentry from '@sentry/node'

import * as logger from '#src/services/logger.js'

import { beforeSendSanitizer } from './sanitizers.js'

// Re-export MCP-specific utilities
export {
  addToolBreadcrumb,
  captureApiError,
  capturePromptError,
  captureToolError,
  categorizeError,
  ErrorCategory,
  setMcpClientContext,
  startToolTransaction
} from './mcp-integration.js'
export { sanitizeObject, sanitizeToolArgs } from './sanitizers.js'

interface SentryOptions {
  dsn?: string
  environment?: string
  hostname?: string
  serviceName?: string
  version?: string
  extra?: Record<string, unknown>
}

interface ExceptionContext {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  user?: { id?: string; email?: string; username?: string }
  level?: string
}

let _initialized = false

/** Check if Sentry is configured and initialized */
export function isConfigured(): boolean {
  return _initialized
}

/**
 * Initialize Sentry with MCP server configuration.
 * All config values come from the caller — no process.env reads (except VITEST).
 */
export function initialize({
  dsn,
  environment,
  hostname,
  serviceName,
  version,
  extra
}: SentryOptions = {}): boolean {
  if (!dsn) {
    if (!process.env.VITEST) {
      logger.warn('[Sentry] Sentry DSN not provided, error tracking disabled')
    }
    _initialized = false
    return false
  }

  Sentry.init({
    dsn,
    environment,
    release: `${serviceName}@${version}`,
    serverName: hostname,

    // Sample rates
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    profilesSampleRate: environment === 'production' ? 0.1 : 0,

    // Capture unhandled errors
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration()
    ],

    // Data sanitization
    beforeSend: beforeSendSanitizer as unknown as Parameters<typeof Sentry.init>[0] extends infer O
      ? O extends { beforeSend?: infer BS }
        ? BS
        : never
      : never,

    // Default tags
    initialScope: {
      tags: {
        'mcp.server': serviceName,
        'mcp.version': version
      }
    },

    // Ignore certain errors
    ignoreErrors: [
      // Ignore client disconnections (normal for SSE)
      'ECONNRESET',
      'EPIPE',
      'Client disconnected',
      // Ignore validation errors in development
      ...(environment === 'development' ? ['Unknown model', 'Missing required'] : [])
    ]
  })

  // Set additional default context
  if (extra) {
    Sentry.setContext('server_config', extra)
  }

  _initialized = true

  logger.info(`[Sentry] Initialized for ${serviceName}@${version} (${environment})`)
  return true
}

/** Capture an exception with optional context */
export function captureException(error: Error, context: ExceptionContext = {}): void {
  if (!isConfigured()) return

  Sentry.withScope((scope) => {
    if (context.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value)
      }
    }

    if (context.extra) {
      scope.setContext('extra', context.extra)
    }

    if (context.user) {
      scope.setUser(context.user)
    }

    if (context.level) {
      scope.setLevel(context.level as Sentry.SeverityLevel)
    }

    Sentry.captureException(error)
  })
}

/** Capture a message (non-error event) */
export function captureMessage(
  message: string,
  level = 'info',
  context: ExceptionContext = {}
): void {
  if (!isConfigured()) return

  Sentry.withScope((scope) => {
    scope.setLevel(level as Sentry.SeverityLevel)

    if (context.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value)
      }
    }

    if (context.extra) {
      scope.setContext('extra', context.extra)
    }

    Sentry.captureMessage(message)
  })
}

/** Set user context for error tracking */
export function setUser(user: { id?: string; email?: string; username?: string }): void {
  if (!isConfigured()) return
  Sentry.setUser(user)
}

/** Clear user context */
export function clearUser(): void {
  if (!isConfigured()) return
  Sentry.setUser(null)
}

/** Add a breadcrumb for debugging context */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (!isConfigured()) return
  Sentry.addBreadcrumb(breadcrumb)
}

/** Flush pending events (call before process exit) */
export async function flush(timeout = 2000): Promise<boolean> {
  if (!isConfigured()) return true
  return Sentry.flush(timeout)
}

/** Close Sentry client (call on shutdown) */
export async function close(timeout = 2000): Promise<boolean> {
  if (!isConfigured()) return true
  return Sentry.close(timeout)
}
