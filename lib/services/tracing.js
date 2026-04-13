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
 * import { initTracing, traceToolCall } from '#lib/services/tracing.js'
 *
 * // Initialize once at startup
 * initTracing({ serviceName: 'engineer-mcp' })
 *
 * // Trace tool calls
 * const result = await traceToolCall('find_model', args, () => handler(args))
 */

// Vendor implementation - change this import to switch vendors
import * as vendor from './vendor/langfuse/index.js'

/**
 * Initialize tracing service
 *
 * Call this once at server startup before handling requests.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.serviceName - Name of the MCP server
 * @param {string} options.version - Server version
 * @returns {boolean} True if initialized successfully
 */
export function initTracing(options = {}) {
  return vendor.initialize(options)
}

/**
 * Check if tracing is configured and enabled
 * @returns {boolean}
 */
export function isTracingEnabled() {
  return vendor.isConfigured()
}

/**
 * Trace an MCP tool call
 *
 * Wraps a tool handler with tracing. Creates a tool-type observation
 * in the tracing backend. Nested API calls within the handler become
 * child spans automatically.
 *
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments (will be sanitized)
 * @param {Function} handler - Async function to execute
 * @param {Object} ctx - Additional context (sessionId, traceContext)
 * @returns {Promise<*>} Handler result
 */
export async function traceToolCall(name, args, handler, ctx = {}) {
  return vendor.traceToolCall(name, args, handler, ctx)
}

/**
 * Trace an API call
 *
 * Wraps an HTTP call with tracing. When called inside a traceToolCall,
 * it automatically nests as a child span.
 *
 * @param {string} method - HTTP method
 * @param {string} url - API endpoint
 * @param {Function} handler - Async function to execute
 * @returns {Promise<*>} Handler result
 */
export async function traceApiCall(method, url, handler) {
  return vendor.traceApiCall(method, url, handler)
}

/**
 * Trace prompt generation
 *
 * @param {string} name - Prompt name
 * @param {Function} handler - Async function to execute
 * @returns {Promise<*>} Handler result
 */
export async function tracePromptGeneration(name, handler) {
  return vendor.tracePromptGeneration(name, handler)
}

/**
 * Set session context for trace grouping
 *
 * Call when a session is established to tag all subsequent traces.
 *
 * @param {Object} ctx - Session context
 * @param {string} [ctx.sessionId] - MCP session ID
 * @param {Object} [ctx.metadata] - Additional metadata
 */
export function setSessionContext(ctx) {
  vendor.setSessionContext(ctx)
}

/**
 * Extract trace context from MCP request metadata
 *
 * Parses W3C traceparent from _meta to link server traces
 * to client-side traces (e.g., LangChain with Langfuse).
 *
 * @param {Object} meta - MCP request _meta object
 * @returns {Object|null} Parsed trace context or null
 */
export function extractTraceContext(meta) {
  return vendor.extractTraceContext(meta)
}

/**
 * Flush pending traces
 *
 * Call before process exit to ensure all traces are sent.
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function flushTracing(timeout = 5000) {
  return vendor.flush(timeout)
}

/**
 * Close tracing service
 *
 * Call on graceful shutdown.
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function closeTracing(timeout = 5000) {
  return vendor.close(timeout)
}
