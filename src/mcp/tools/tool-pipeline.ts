/**
 * Tool Execution Pipeline
 *
 * Provides composable interceptors for cross-cutting concerns around tool execution:
 * auth wrapping, tracing, logging, error handling, audit, permissions, metrics.
 *
 * Interceptors run in declared order for `before`, and reverse order for `after`/`onError`
 * (outermost wrapper sees the final result or first error).
 *
 * @example
 * import { wrapToolHandler } from 'mcp-kit/tools'
 *
 * const handler = wrapToolHandler('find_records', [tracingInterceptor, auditInterceptor], async (args) => {
 *   return tool.execute(args)
 * })
 */

import type { ToolHandlerExtra, ToolResult } from './base-tool.js'

// ============================================================================
// Types
// ============================================================================

/** Context passed to interceptor hooks */
export interface ToolContext {
  /** Tool name (e.g., 'find_records') */
  toolName: string
  /** Tool arguments (mutable — `before` hooks may modify) */
  args: Record<string, unknown>
  /** Session ID when available */
  sessionId?: string
  /** Mutable bag for passing data between before/after/onError hooks */
  meta: Record<string, unknown>
  /** SDK request handler extra (progress token, abort signal, etc.) */
  extra?: ToolHandlerExtra
}

/**
 * Interceptor for tool execution pipeline.
 *
 * All hooks are optional. A single interceptor typically implements
 * one concern (tracing, logging, auth, audit).
 */
export interface ToolInterceptor {
  /** Display name for debugging */
  name?: string

  /**
   * Runs before tool.execute().
   * Can modify ctx.args or ctx.meta. Throw to abort execution.
   */
  before?(ctx: ToolContext): void | Promise<void>

  /**
   * Runs after successful execute().
   * Return the result (possibly transformed) or void to pass through.
   */
  after?(ctx: ToolContext, result: ToolResult): ToolResult | void | Promise<ToolResult | void>

  /**
   * Runs on execute() error.
   * Return a ToolResult to recover (swallow the error).
   * Return void to let the error propagate to the next onError handler.
   */
  onError?(ctx: ToolContext, error: Error): ToolResult | void | Promise<ToolResult | void>
}

// ============================================================================
// Pipeline
// ============================================================================

/** Handler function type used by the tool pipeline */
export type ToolHandler = (
  args: Record<string, unknown>,
  extra?: ToolHandlerExtra
) => Promise<ToolResult>

/**
 * Wrap a tool handler with an interceptor chain.
 *
 * - `before` hooks run in array order (first interceptor runs first).
 * - `after` hooks run in reverse order (last interceptor's after runs first,
 *   outermost wrapper sees final result).
 * - `onError` hooks run in reverse order. The first one that returns a
 *   ToolResult recovers from the error; subsequent onError hooks are skipped.
 *   If none recover, the error is re-thrown.
 *
 * @param toolName - Tool name for context
 * @param interceptors - Interceptor chain (applied in order)
 * @param handler - The actual tool handler to wrap
 * @param options - Optional context fields (sessionId)
 * @returns Wrapped handler with the same signature
 */
export function wrapToolHandler(
  toolName: string,
  interceptors: ToolInterceptor[],
  handler: ToolHandler,
  options: { sessionId?: string } = {}
): ToolHandler {
  if (interceptors.length === 0) return handler

  return async (args: Record<string, unknown>, extra?: ToolHandlerExtra): Promise<ToolResult> => {
    const ctx: ToolContext = {
      toolName,
      args: { ...args },
      sessionId: options.sessionId,
      meta: {},
      extra
    }

    let result: ToolResult
    try {
      // Run before hooks in order
      for (const interceptor of interceptors) {
        if (interceptor.before) {
          await interceptor.before(ctx)
        }
      }

      // Execute handler
      result = await handler(ctx.args, ctx.extra)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // Run onError hooks in reverse order
      for (let i = interceptors.length - 1; i >= 0; i--) {
        const interceptor = interceptors[i]!
        if (interceptor.onError) {
          const recovered = await interceptor.onError(ctx, error)
          if (recovered) return recovered
        }
      }

      // No interceptor recovered — re-throw
      throw error
    }

    // Run after hooks in reverse order
    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i]!
      if (interceptor.after) {
        const transformed = await interceptor.after(ctx, result)
        if (transformed) result = transformed
      }
    }

    return result
  }
}
