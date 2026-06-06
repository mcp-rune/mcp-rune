/**
 * Built-in Tool Interceptors
 *
 * Ready-to-use interceptors for common cross-cutting concerns.
 * These replace the manual wrapping pattern found in integrator tool registries.
 *
 * @example
 * import { ToolRegistry } from '@mcp-rune/mcp-rune/tools'
 *
 * // ToolRegistry applies these automatically. For manual use:
 * import { loggingInterceptor, tracingInterceptor, errorInterceptor } from '@mcp-rune/mcp-rune/tools'
 * const handler = wrapToolHandler('find_records', [loggingInterceptor(), tracingInterceptor()], rawHandler)
 */

import * as logger from '#src/runtime/logger.js'

import type { ToolResult } from './base-tool.js'
import type { ToolInterceptor } from './tool-pipeline.js'

// ============================================================================
// Logging Interceptor
// ============================================================================

export interface LoggingInterceptorOptions {
  /** Additional metadata merged into every log entry */
  logContext?: Record<string, unknown>
}

/**
 * Logs tool call start and errors.
 *
 * Replaces the manual `logger.info('Tool called', ...)` + `logger.error('Tool error', ...)`
 * pattern repeated in every integrator registry.
 */
export function loggingInterceptor(options: LoggingInterceptorOptions = {}): ToolInterceptor {
  const logContext = options.logContext ?? {}

  return {
    name: 'logging',
    before(ctx) {
      logger.info('Tool called', { ...logContext, tool: ctx.toolName })
    },
    onError(ctx, error) {
      logger.error('Tool error', { ...logContext, tool: ctx.toolName, error: error.message })
    }
  }
}

// ============================================================================
// Tracing Interceptor
// ============================================================================

/**
 * Wraps tool execution with distributed tracing via traceToolCall.
 *
 * Replaces the manual `tracing.traceToolCall(toolName, args, () => ...)` wrapper
 * in every integrator registry. The interceptor stores the traced result in ctx.meta
 * so downstream interceptors see it.
 */
export function tracingInterceptor(): ToolInterceptor {
  return {
    name: 'tracing',

    // Tracing wraps the entire execution, so it's implemented as a before+after pair
    // that records timing. The actual tracing.traceToolCall wrapper is applied at
    // the ToolRegistry level where it can wrap the full handler (see tool-registry.ts).
    // This interceptor is a no-op placeholder for manual pipeline composition.
    //
    // When used via ToolRegistry, tracing is applied as the outermost wrapper
    // around the interceptor chain, not as an interceptor itself. This is the
    // correct semantic: tracing should capture everything including interceptor work.
    before(ctx) {
      ctx.meta._tracingStart = Date.now()
    },
    after(ctx) {
      ctx.meta._tracingDuration = Date.now() - (ctx.meta._tracingStart as number)
    }
  }
}

// ============================================================================
// Error Catch Interceptor
// ============================================================================

/**
 * Catches unhandled errors and returns a structured MCP error response.
 *
 * Replaces the manual `catch(err) → { content: [{ type: 'text', text: Error: ... }], isError: true }`
 * pattern in every integrator registry. Should be the last interceptor in the chain
 * (first to run onError in reverse order) so it catches anything not handled by
 * earlier interceptors.
 */
export function errorInterceptor(): ToolInterceptor {
  return {
    name: 'error-catch',
    onError(_ctx, error): ToolResult {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      }
    }
  }
}
