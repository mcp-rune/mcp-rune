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

import { propagateAttributes, startActiveObservation } from '@langfuse/tracing'

import * as logger from '../../logger.js'
import { sanitizeToolArgs } from '../../sanitizers.js'

interface TraceContext {
  traceId: string
  spanId: string
  traceFlags: number
}

interface SessionAttributes {
  sessionId?: string
  metadata?: Record<string, string>
}

interface ToolCallContext {
  sessionId?: string
  traceContext?: TraceContext
}

// Langfuse span type from the SDK
interface LangfuseSpan {
  update(data: Record<string, unknown>): void
}

let configured = false
let sessionAttributes: SessionAttributes | null = null

/** Set whether Langfuse is configured (called by index.js) */
export function setConfigured(value: boolean): void {
  configured = value
  if (!value) sessionAttributes = null
}

/**
 * Extract W3C trace context from MCP request _meta
 *
 * LangChain clients can pass a `traceparent` header in _meta to link
 * MCP server traces to the client-side trace.
 *
 * @example
 * // W3C traceparent format: version-traceId-parentId-traceFlags
 * extractTraceContext({ traceparent: '00-abc123...-def456...-01' })
 */
export function extractTraceContext(
  meta: Record<string, unknown> | null | undefined
): TraceContext | null {
  if (!(meta as Record<string, unknown> | undefined)?.traceparent) return null

  const parts = String((meta as Record<string, unknown>).traceparent).split('-')
  if (parts.length !== 4) return null

  const [version, traceId, spanId, flags] = parts

  // Validate format
  if (version !== '00' || traceId!.length !== 32 || spanId!.length !== 16) {
    return null
  }

  return {
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: parseInt(flags!, 16)
  }
}

/**
 * Start an observation with session context propagated if available.
 *
 * `propagateAttributes` is scoped — attributes only exist within its callback.
 * When session attributes are set, we wrap `startActiveObservation` inside
 * `propagateAttributes` so session info appears on the trace.
 */
function observeWithSessionContext<T>(
  name: string,
  callback: (span: LangfuseSpan) => Promise<T>,
  options?: Record<string, unknown>
): Promise<T> {
  const args: [string, (span: LangfuseSpan) => Promise<T>, ...unknown[]] = options
    ? [name, callback, options]
    : [name, callback]

  if (sessionAttributes) {
    return propagateAttributes(sessionAttributes, () =>
      (startActiveObservation as (...a: unknown[]) => Promise<T>)(...args)
    )
  }
  return (startActiveObservation as (...a: unknown[]) => Promise<T>)(...args)
}

/**
 * Trace an MCP tool call
 *
 * Creates a Langfuse observation of type 'tool' for the tool execution.
 * The handler callback runs inside the observation scope, so any nested
 * traceApiCall invocations become child spans automatically.
 */
export async function traceToolCall<T>(
  name: string,
  args: Record<string, unknown>,
  handler: () => Promise<T> | T,
  ctx: ToolCallContext = {}
): Promise<T> {
  if (!configured) return handler()

  const options: Record<string, unknown> = { asType: 'tool' }

  // Link to parent trace if context provided
  if (ctx.traceContext) {
    options.parentSpanContext = ctx.traceContext
  }

  let handlerCalled = false

  try {
    return await observeWithSessionContext<T>(
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
              error: (error as Error).message,
              errorType: (error as Error).constructor.name
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
      error: (error as Error).message
    })
    return handler()
  }
}

/**
 * Trace an API call
 *
 * Creates a Langfuse span observation for HTTP API calls. When called
 * inside a traceToolCall callback, it automatically nests as a child span.
 */
export async function traceApiCall<T>(
  method: string,
  url: string,
  handler: () => Promise<T> | T
): Promise<T> {
  if (!configured) return handler()

  let handlerCalled = false

  try {
    return await observeWithSessionContext<T>(`${method} ${url}`, async (span) => {
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
            error: (error as Error).message,
            status: (error as Error & { response?: { status?: number } }).response?.status,
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
      error: (error as Error).message
    })
    return handler()
  }
}

/**
 * Trace prompt generation
 *
 * Creates a Langfuse span observation for prompt content generation.
 */
export async function tracePromptGeneration<T>(
  name: string,
  handler: () => Promise<T> | T
): Promise<T> {
  if (!configured) return handler()

  let handlerCalled = false

  try {
    return await observeWithSessionContext<T>(`mcp.prompt.${name}`, async (span) => {
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
            error: (error as Error).message,
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
      error: (error as Error).message
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
 */
export function setSessionContext(ctx: {
  sessionId?: string
  metadata?: Record<string, string>
}): void {
  if (!configured) return

  try {
    const attributes: SessionAttributes = {}
    if (ctx.sessionId) attributes.sessionId = ctx.sessionId
    if (ctx.metadata) attributes.metadata = ctx.metadata

    sessionAttributes = attributes
  } catch (error) {
    logger.warn('Failed to set session context', {
      service: 'langfuse',
      error: (error as Error).message
    })
  }
}
