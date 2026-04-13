/**
 * Data sanitization utilities for Sentry
 *
 * Re-exports shared sanitizers and adds Sentry-specific beforeSend hook.
 */

import { sanitizeObject, sanitizeHeaders, sanitizeToolArgs } from '../../sanitizers.js'

// Re-export shared sanitizers (backward-compatible)
export { sanitizeObject, sanitizeHeaders, sanitizeToolArgs }

/**
 * Sentry beforeSend hook for final sanitization
 * @param {Object} event - Sentry event
 * @returns {Object|null} Sanitized event or null to drop
 */
export function beforeSendSanitizer(event) {
  // Sanitize request data
  if (event.request?.headers) {
    event.request.headers = sanitizeHeaders(event.request.headers)
  }

  if (event.request?.data) {
    event.request.data = sanitizeObject(event.request.data)
  }

  // Sanitize breadcrumbs
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      if (breadcrumb.data) {
        breadcrumb.data = sanitizeObject(breadcrumb.data)
      }
      return breadcrumb
    })
  }

  // Sanitize extra context
  if (event.extra) {
    event.extra = sanitizeObject(event.extra)
  }

  return event
}
