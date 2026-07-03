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
 * import { loggingInterceptor, errorInterceptor } from '@mcp-rune/mcp-rune/tools'
 * const handler = wrapToolHandler('find_records', [loggingInterceptor()], rawHandler)
 *
 * Distributed tracing is not an interceptor — `ToolRegistry` wraps the whole
 * handler (interceptor chain included) in `tracing.traceToolCall`, which the
 * before/after interceptor shape cannot do.
 */

import * as logger from '#src/runtime/logger.js'

import type { ToolInterceptor } from './tool-pipeline.js'
import type { ToolResult } from './tool-result.js'

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
