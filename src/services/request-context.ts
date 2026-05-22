/**
 * Request Context
 *
 * AsyncLocalStorage-backed per-request scope. Lets any code path within
 * an Express request — tool handlers, API clients, OAuth flows — read
 * the current `requestId` without having to thread it through every
 * function signature.
 *
 * The HTTP server's request-id middleware wraps `next()` in
 * `requestContext.run({ requestId }, next)` so the ID propagates
 * through async hooks for the lifetime of the request. The logger
 * format pipeline reads the current ID and injects it into every log
 * entry, giving free distributed-tracing correlation in Loki/Grafana
 * without call-site changes.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

/** Returns the current request's ID, or `undefined` outside a request scope. */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId
}

/** Runs `fn` with `requestId` bound to the current async scope. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn)
}
