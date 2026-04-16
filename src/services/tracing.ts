/**
 * Tracing Service - Vendor-Agnostic Public API
 *
 * This module provides a stable API for distributed tracing that abstracts
 * the underlying vendor implementation (currently Langfuse).
 *
 * To switch vendors, update the import and ensure the vendor module
 * exports the same interface.
 *
 * @example
 * import { initTracing, traceToolCall } from '#src/services/tracing.js'
 *
 * // Initialize once at startup
 * initTracing({ serviceName: 'engineer-mcp' })
 *
 * // Trace tool calls
 * const result = await traceToolCall('find_model', args, () => handler(args))
 */

// Vendor implementation - change this import to switch vendors
import * as vendor from './vendor/langfuse/index.js'

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
  return vendor.initialize(options)
}

/** Check if tracing is configured and enabled */
export function isTracingEnabled(): boolean {
  return vendor.isConfigured()
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
  return vendor.traceToolCall(name, args, handler, ctx)
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
  return vendor.traceApiCall(method, url, handler)
}

/** Trace prompt generation */
export async function tracePromptGeneration<T>(
  name: string,
  handler: () => Promise<T> | T
): Promise<T> {
  return vendor.tracePromptGeneration(name, handler)
}

/**
 * Set session context for trace grouping
 *
 * Call when a session is established to tag all subsequent traces.
 */
export function setSessionContext(ctx: SessionContext): void {
  vendor.setSessionContext(ctx)
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
  return vendor.extractTraceContext(meta)
}

/**
 * Flush pending traces
 *
 * Call before process exit to ensure all traces are sent.
 */
export async function flushTracing(timeout = 5000): Promise<void> {
  return vendor.flush(timeout)
}

/**
 * Close tracing service
 *
 * Call on graceful shutdown.
 */
export async function closeTracing(timeout = 5000): Promise<void> {
  return vendor.close(timeout)
}
