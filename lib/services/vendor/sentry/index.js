/**
 * Sentry Error Tracking Vendor Implementation
 *
 * Provides Sentry-specific initialization and configuration.
 * This module should only be imported by lib/services/error-tracking.js
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/node/
 */

import * as Sentry from '@sentry/node'
import * as logger from '#lib/services/logger.js'
import { beforeSendSanitizer } from './sanitizers.js'

// Re-export MCP-specific utilities
export {
  captureToolError,
  captureApiError,
  capturePromptError,
  startToolTransaction,
  addToolBreadcrumb,
  setMcpClientContext,
  categorizeError,
  ErrorCategory
} from './mcp-integration.js'

export { sanitizeToolArgs, sanitizeObject } from './sanitizers.js'

let _initialized = false

/**
 * Check if Sentry is configured and initialized
 * @returns {boolean}
 */
export function isConfigured() {
  return _initialized
}

/**
 * Initialize Sentry with MCP server configuration.
 * All config values come from the caller — no process.env reads (except VITEST).
 *
 * @param {Object} options - Configuration options
 * @param {string} options.dsn - Sentry DSN
 * @param {string} options.environment - Runtime environment (e.g., 'production')
 * @param {string} options.hostname - Server hostname
 * @param {string} options.serviceName - Name of the MCP server
 * @param {string} options.version - Server version
 * @param {Object} options.extra - Additional default context
 */
export function initialize({ dsn, environment, hostname, serviceName, version, extra } = {}) {
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
    beforeSend: beforeSendSanitizer,

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

/**
 * Capture an exception with optional context
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context
 */
export function captureException(error, context = {}) {
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
      scope.setLevel(context.level)
    }

    Sentry.captureException(error)
  })
}

/**
 * Capture a message (non-error event)
 * @param {string} message - Message to capture
 * @param {string} level - Severity level
 * @param {Object} context - Additional context
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (!isConfigured()) return

  Sentry.withScope((scope) => {
    scope.setLevel(level)

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

/**
 * Set user context for error tracking
 * @param {Object} user - User information
 * @param {string} user.id - User ID
 * @param {string} user.email - User email (optional)
 * @param {string} user.username - Username (optional)
 */
export function setUser(user) {
  if (!isConfigured()) return
  Sentry.setUser(user)
}

/**
 * Clear user context
 */
export function clearUser() {
  if (!isConfigured()) return
  Sentry.setUser(null)
}

/**
 * Add a breadcrumb for debugging context
 * @param {Object} breadcrumb - Breadcrumb data
 */
export function addBreadcrumb(breadcrumb) {
  if (!isConfigured()) return
  Sentry.addBreadcrumb(breadcrumb)
}

/**
 * Flush pending events (call before process exit)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function flush(timeout = 2000) {
  if (!isConfigured()) return true
  return Sentry.flush(timeout)
}

/**
 * Close Sentry client (call on shutdown)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function close(timeout = 2000) {
  if (!isConfigured()) return true
  return Sentry.close(timeout)
}
