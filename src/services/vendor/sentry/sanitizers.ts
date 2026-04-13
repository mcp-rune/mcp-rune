/**
 * Data sanitization utilities for Sentry
 *
 * Re-exports shared sanitizers and adds Sentry-specific beforeSend hook.
 */

import { sanitizeObject, sanitizeHeaders, sanitizeToolArgs } from '../../sanitizers.js'

// Re-export shared sanitizers (backward-compatible)
export { sanitizeObject, sanitizeHeaders, sanitizeToolArgs }

interface SentryBreadcrumb {
  data?: Record<string, unknown>
  [key: string]: unknown
}

interface SentryEvent {
  request?: {
    headers?: Record<string, string>
    data?: Record<string, unknown>
  }
  breadcrumbs?: SentryBreadcrumb[]
  extra?: Record<string, unknown>
  [key: string]: unknown
}

/** Sentry beforeSend hook for final sanitization */
export function beforeSendSanitizer(event: SentryEvent): SentryEvent | null {
  // Sanitize request data
  if (event.request?.headers) {
    event.request.headers = sanitizeHeaders(event.request.headers)
  }

  if (event.request?.data) {
    event.request.data = sanitizeObject(event.request.data) as Record<string, unknown>
  }

  // Sanitize breadcrumbs
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      if (breadcrumb.data) {
        breadcrumb.data = sanitizeObject(breadcrumb.data) as Record<string, unknown>
      }
      return breadcrumb
    })
  }

  // Sanitize extra context
  if (event.extra) {
    event.extra = sanitizeObject(event.extra) as Record<string, unknown>
  }

  return event
}
