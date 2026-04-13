/**
 * MCP-specific Langfuse tracing integration
 *
 * Provides instrumentation for MCP server tool calls, API calls,
 * and prompt generation using Langfuse's observation-based tracing.
 *
 * All functions use a wrapper pattern: they accept a handler callback
 * and return its result. When Langfuse is not configured, they call
 * the handler directly with zero overhead.
 *
 * @see https://langfuse.com/docs/observability/sdk/typescript/instrumentation
 */

import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { sanitizeToolArgs } from '../../sanitizers.js'
import * as logger from '../../logger.js'

let configured = false
let sessionAttributes = null

/**
 * Set whether Langfuse is configured (called by index.js)
 * @param {boolean} value
 */
export function setConfigured(value) {
  configured = value
  if (!value) sessionAttributes = null
}

/**
 * Extract W3C trace context from MCP request _meta
 *
 * LangChain clients can pass a `traceparent` header in _meta to link
 * MCP server traces to the client-side trace.
 *
 * @param {Object} meta - MCP request _meta object
 * @returns {Object|null} Parsed trace context { traceId, spanId, traceFlags } or null
 *
 * @example
 * // W3C traceparent format: version-traceId-parentId-traceFlags
 * extractTraceContext({ traceparent: '00-abc123...-def456...-01' })
 */
export function extractTraceContext(meta) {
  if (!meta?.traceparent) return null

  const parts = meta.traceparent.split('-')
  if (parts.length !== 4) return null

  const [version, traceId, spanId, flags] = parts

  // Validate format
  if (version !== '00' || traceId.length !== 32 || spanId.length !== 16) {
    return null
  }

  return {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16)
  }
}

/**
 * Start an observation with session context propagated if available.
 *
 * `propagateAttributes` is scoped — attributes only exist within its callback.
 * When session attributes are set, we wrap `startActiveObservation` inside
 * `propagateAttributes` so session info appears on the trace.
 *
 * @param {string} name - Observation name
 * @param {Function} callback - Observation callback receiving span
 * @param {Object} [options] - Options for startActiveObservation
 * @returns {Promise<*>} Callback result
 */
function observeWithSessionContext(name, callback, options) {
  const args = options ? [name, callback, options] : [name, callback]

  if (sessionAttributes) {
    return propagateAttributes(sessionAttributes, () => startActiveObservation(...args))
  }
  return startActiveObservation(...args)
}

/**
 * Trace an MCP tool call
 *
 * Creates a Langfuse observation of type 'tool' for the tool execution.
 * The handler callback runs inside the observation scope, so any nested
 * traceApiCall invocations become child spans automatically.
 *
 * @param {string} name - Tool name (e.g., 'find_model', 'create_brand')
 * @param {Object} args - Tool arguments (will be sanitized)
 * @param {Function} handler - Async function to execute
 * @param {Object} ctx - Additional context
 * @param {string} [ctx.sessionId] - MCP session ID
 * @param {Object} [ctx.traceContext] - Parsed W3C trace context
 * @returns {Promise<*>} Handler result
 */
export async function traceToolCall(name, args, handler, ctx = {}) {
  if (!configured) return handler()

  const options = { asType: 'tool' }

  // Link to parent trace if context provided
  if (ctx.traceContext) {
    options.parentSpanContext = ctx.traceContext
  }

  let handlerCalled = false

  try {
    return await observeWithSessionContext(
      `mcp.tool.${name}`,
      async (span) => {
        span.update({
          input: sanitizeToolArgs(args),
          metadata: {
            tool: name,
            argsCount: Object.keys(args).length,
            ...(ctx.sessionId && { sessionId: ctx.sessionId }),
            component: 'tool'
          }
        })

        handlerCalled = true
        try {
          const result = await handler()
          span.update({ output: result })
          return result
        } catch (error) {
          span.update({
            metadata: {
              error: error.message,
              errorType: error.constructor.name
            },
            level: 'ERROR'
          })
          throw error
        }
      },
      options
    )
  } catch (error) {
    if (handlerCalled) throw error
    logger.warn('Tracing failed, executing without trace', {
      service: 'langfuse',
      operation: 'traceToolCall',
      tool: name,
      error: error.message
    })
    return handler()
  }
}

/**
 * Trace an API call
 *
 * Creates a Langfuse span observation for HTTP API calls. When called
 * inside a traceToolCall callback, it automatically nests as a child span.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - API endpoint
 * @param {Function} handler - Async function to execute
 * @returns {Promise<*>} Handler result
 */
export async function traceApiCall(method, url, handler) {
  if (!configured) return handler()

  let handlerCalled = false

  try {
    return await observeWithSessionContext(`${method} ${url}`, async (span) => {
      span.update({
        metadata: {
          httpMethod: method,
          url,
          component: 'api_client'
        }
      })

      handlerCalled = true
      try {
        const result = await handler()
        span.update({ output: { status: 'success' } })
        return result
      } catch (error) {
        span.update({
          metadata: {
            error: error.message,
            status: error.response?.status,
            component: 'api_client'
          },
          level: 'ERROR'
        })
        throw error
      }
    })
  } catch (error) {
    if (handlerCalled) throw error
    logger.warn('Tracing failed, executing without trace', {
      service: 'langfuse',
      operation: 'traceApiCall',
      endpoint: `${method} ${url}`,
      error: error.message
    })
    return handler()
  }
}

/**
 * Trace prompt generation
 *
 * Creates a Langfuse span observation for prompt content generation.
 *
 * @param {string} name - Prompt name (e.g., 'create_brand')
 * @param {Function} handler - Async function to execute
 * @returns {Promise<*>} Handler result
 */
export async function tracePromptGeneration(name, handler) {
  if (!configured) return handler()

  let handlerCalled = false

  try {
    return await observeWithSessionContext(`mcp.prompt.${name}`, async (span) => {
      span.update({
        metadata: {
          prompt: name,
          component: 'prompt'
        }
      })

      handlerCalled = true
      try {
        const result = await handler()
        return result
      } catch (error) {
        span.update({
          metadata: {
            error: error.message,
            component: 'prompt'
          },
          level: 'ERROR'
        })
        throw error
      }
    })
  } catch (error) {
    if (handlerCalled) throw error
    logger.warn('Tracing failed, executing without trace', {
      service: 'langfuse',
      operation: 'tracePromptGeneration',
      prompt: name,
      error: error.message
    })
    return handler()
  }
}

/**
 * Set session context for trace grouping
 *
 * Stores session-level attributes in module state. These attributes are
 * applied per-trace via `propagateAttributes` wrapping (since propagateAttributes
 * is scoped to its callback).
 *
 * @param {Object} ctx - Session context
 * @param {string} [ctx.sessionId] - MCP session ID
 * @param {Object} [ctx.metadata] - Additional metadata (transport, client info)
 */
export function setSessionContext(ctx) {
  if (!configured) return

  try {
    const attributes = {}
    if (ctx.sessionId) attributes.sessionId = ctx.sessionId
    if (ctx.metadata) attributes.metadata = ctx.metadata

    sessionAttributes = attributes
  } catch (error) {
    logger.warn('Failed to set session context', {
      service: 'langfuse',
      error: error.message
    })
  }
}
