/**
 * Tracing Service — stable public API over the Langfuse integration.
 *
 * The `integrations/langfuse` module is an anti-corruption facade over the
 * `@langfuse/otel` npm package (not vendored source). The facade earns its
 * place with three jobs: it injects the shared `sanitizers` redaction into
 * every span, turns tracing into a no-op when no key is configured
 * (graceful-disable), and keeps this module's surface stable across the
 * OpenTelemetry/Langfuse major-version churn underneath. See ADR 0005.
 *
 * @example
 * import { initTracing, traceToolCall } from '#src/runtime/tracing.js'
 *
 * // Initialize once at startup
 * initTracing({ serviceName: 'my-mcp-server' })
 *
 * // Trace tool calls
 * const result = await traceToolCall('find_records', args, () => handler(args))
 */

import * as integration from './integrations/langfuse/index.js'

export interface TracingOptions {
  serviceName?: string
  version?: string
}

export interface SessionContext {
  sessionId?: string
  metadata?: Record<string, string>
}

export interface TraceContext {
  traceId: string
  spanId: string
  traceFlags: number
}

export interface ToolCallContext {
  sessionId?: string
  traceContext?: TraceContext
}

/**
 * Initialize tracing service
 *
 * Call this once at server startup before handling requests.
 */
export function initTracing(options: TracingOptions = {}): boolean {
  return integration.initialize(options)
}

/** Check if tracing is configured and enabled */
export function isTracingEnabled(): boolean {
  return integration.isConfigured()
}

/**
 * Trace an MCP tool call
 *
 * Wraps a tool handler with tracing. Creates a tool-type observation
 * in the tracing backend. Nested API calls within the handler become
 * child spans automatically.
 */
export async function traceToolCall<T>(
  name: string,
  args: Record<string, unknown>,
  handler: () => Promise<T> | T,
  ctx: ToolCallContext = {}
): Promise<T> {
  return integration.traceToolCall(name, args, handler, ctx)
}

/**
 * Trace an API call
 *
 * Wraps an HTTP call with tracing. When called inside a traceToolCall,
 * it automatically nests as a child span.
 */
export async function traceApiCall<T>(
  method: string,
  url: string,
  handler: () => Promise<T> | T
): Promise<T> {
  return integration.traceApiCall(method, url, handler)
}

/** Trace prompt generation */
export async function tracePromptGeneration<T>(
  name: string,
  handler: () => Promise<T> | T
): Promise<T> {
  return integration.tracePromptGeneration(name, handler)
}

/**
 * Set session context for trace grouping
 *
 * Call when a session is established to tag all subsequent traces.
 */
export function setSessionContext(ctx: SessionContext): void {
  integration.setSessionContext(ctx)
}

/**
 * Extract trace context from MCP request metadata
 *
 * Parses W3C traceparent from _meta to link server traces
 * to client-side traces (e.g., LangChain with Langfuse).
 */
export function extractTraceContext(
  meta: Record<string, unknown> | null | undefined
): TraceContext | null {
  return integration.extractTraceContext(meta)
}

/**
 * Flush pending traces
 *
 * Call before process exit to ensure all traces are sent.
 */
export async function flushTracing(timeout = 5000): Promise<void> {
  return integration.flush(timeout)
}

/**
 * Close tracing service
 *
 * Call on graceful shutdown.
 */
export async function closeTracing(timeout = 5000): Promise<void> {
  return integration.close(timeout)
}
