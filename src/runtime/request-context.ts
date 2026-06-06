/**
 * Request Context
 *
 * AsyncLocalStorage-backed per-request scope. Lets any code path within
 * an Express request — tool handlers, API clients, OAuth flows — read
 * the current `requestId` without having to thread it through every
 * function signature.
 *
 * The HTTP server's request-id middleware wraps `next()` in
 * `requestContext.run({ requestId, upstream }, next)` so the ID propagates
 * through async hooks for the lifetime of the request. The logger
 * format pipeline reads the current ID and injects it into every log
 * entry, giving free distributed-tracing correlation in Loki/Grafana
 * without call-site changes.
 *
 * `upstream` is a mutable accumulator: outbound HTTP interceptors call
 * `addUpstreamDuration(ms)` after each upstream call completes, and the
 * inbound request-logger middleware reads it on `res.finish` to render
 * the per-request proxy overhead (total - upstream).
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface UpstreamAccumulator {
  totalMs: number
  calls: number
}

export interface RequestContext {
  requestId: string
  upstream: UpstreamAccumulator
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

/** Returns the current request's ID, or `undefined` outside a request scope. */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId
}

/** Returns the current request's upstream accumulator, or `undefined` outside a request scope. */
export function getUpstream(): UpstreamAccumulator | undefined {
  return requestContext.getStore()?.upstream
}

/**
 * Record one completed upstream call's wall-clock duration. Parallel calls
 * are summed (additive, like Rails' `lograge` `db=` field) — not
 * overlap-aware. No-op outside a request scope (e.g. startup-time calls).
 */
export function addUpstreamDuration(ms: number): void {
  const upstream = requestContext.getStore()?.upstream
  if (!upstream) return
  upstream.totalMs += ms
  upstream.calls += 1
}

/** Runs `fn` with `requestId` bound to the current async scope. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId, upstream: { totalMs: 0, calls: 0 } }, fn)
}
