/**
 * MCP-specific Sentry integration
 *
 * Provides instrumentation for MCP server tools, transports, and protocols.
 * Based on Sentry's MCP server monitoring approach.
 *
 * @see https://blog.sentry.io/introducing-mcp-server-monitoring/
 */

import * as Sentry from '@sentry/node'
import { sanitizeToolArgs } from './sanitizers.js'

/** MCP error categories for grouping and alerting */
export const ErrorCategory = {
  VALIDATION: 'validation_error',
  AUTH: 'auth_error',
  NOT_FOUND: 'not_found',
  CONNECTION: 'connection_error',
  RATE_LIMIT: 'rate_limit',
  TIMEOUT: 'timeout',
  INTERNAL: 'internal_error'
} as const

export type ErrorCategoryValue = (typeof ErrorCategory)[keyof typeof ErrorCategory]

interface ErrorWithResponse extends Error {
  response?: { status?: number }
  code?: string
}

/** Categorize an error for proper grouping in Sentry */
export function categorizeError(error: Error): ErrorCategoryValue {
  const message = error.message?.toLowerCase() || ''
  const status = (error as ErrorWithResponse).response?.status
  const code = (error as ErrorWithResponse).code

  // Check error codes first (most specific)
  // Connection errors by code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    return ErrorCategory.CONNECTION
  }

  // Timeouts by code
  if (code === 'ETIMEDOUT') {
    return ErrorCategory.TIMEOUT
  }

  // HTTP status codes (second priority)
  if (status === 400 || status === 422) {
    return ErrorCategory.VALIDATION
  }

  if (status === 401 || status === 403) {
    return ErrorCategory.AUTH
  }

  if (status === 404) {
    return ErrorCategory.NOT_FOUND
  }

  if (status === 429) {
    return ErrorCategory.RATE_LIMIT
  }

  // Message-based categorization (last resort)
  if (
    message.includes('unknown model') ||
    message.includes('invalid') ||
    message.includes('required') ||
    message.includes('missing')
  ) {
    return ErrorCategory.VALIDATION
  }

  if (message.includes('unauthorized') || message.includes('forbidden')) {
    return ErrorCategory.AUTH
  }

  if (message.includes('rate limit') || message.includes('too many requests')) {
    return ErrorCategory.RATE_LIMIT
  }

  if (message.includes('timeout')) {
    return ErrorCategory.TIMEOUT
  }

  if (message.includes('connection')) {
    return ErrorCategory.CONNECTION
  }

  // "not found" is checked last since it's ambiguous
  if (message.includes('not found')) {
    return ErrorCategory.NOT_FOUND
  }

  return ErrorCategory.INTERNAL
}

/** Determine alert level based on error category */
export function getAlertLevel(category: ErrorCategoryValue): string {
  switch (category) {
    case ErrorCategory.CONNECTION:
    case ErrorCategory.AUTH:
      return 'error'
    case ErrorCategory.INTERNAL:
      return 'error'
    case ErrorCategory.RATE_LIMIT:
    case ErrorCategory.TIMEOUT:
      return 'warning'
    case ErrorCategory.VALIDATION:
    case ErrorCategory.NOT_FOUND:
      return 'info'
    default:
      return 'error'
  }
}

/** Capture a tool execution error with MCP context */
export function captureToolError(
  error: Error,
  toolName: string,
  args: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
): void {
  const category = categorizeError(error)
  const level = getAlertLevel(category)

  Sentry.withScope((scope) => {
    // Set tags for filtering and grouping
    scope.setTag('mcp.tool', toolName)
    scope.setTag('error.category', category)
    scope.setTag('mcp.component', 'tool')

    // Set level based on category
    scope.setLevel(level as Sentry.SeverityLevel)

    // Add sanitized context
    scope.setContext('mcp_tool', {
      name: toolName,
      args: sanitizeToolArgs(args),
      category,
      ...context
    })

    // Set fingerprint for better grouping
    // Group by tool + error category + error message pattern
    scope.setFingerprint([toolName, category, error.message?.split(':')[0] || 'unknown'])

    Sentry.captureException(error)
  })
}

/** Capture an API client error */
export function captureApiError(
  error: Error,
  endpoint: string,
  method = 'GET',
  context: Record<string, unknown> = {}
): void {
  const category = categorizeError(error)
  const level = getAlertLevel(category)

  Sentry.withScope((scope) => {
    scope.setTag('mcp.component', 'api_client')
    scope.setTag('error.category', category)
    scope.setTag('http.method', method)
    scope.setLevel(level as Sentry.SeverityLevel)

    scope.setContext('api_request', {
      endpoint,
      method,
      status: (error as ErrorWithResponse).response?.status,
      category,
      ...context
    })

    scope.setFingerprint(['api_client', method, endpoint, category])

    Sentry.captureException(error)
  })
}

/** Capture a prompt execution error */
export function capturePromptError(
  error: Error,
  promptName: string,
  context: Record<string, unknown> = {}
): void {
  const category = categorizeError(error)

  Sentry.withScope((scope) => {
    scope.setTag('mcp.prompt', promptName)
    scope.setTag('error.category', category)
    scope.setTag('mcp.component', 'prompt')

    scope.setContext('mcp_prompt', {
      name: promptName,
      category,
      ...context
    })

    scope.setFingerprint([promptName, category])

    Sentry.captureException(error)
  })
}

/** Create a transaction for tool execution tracking */
export function startToolTransaction(toolName: string, args: Record<string, unknown> = {}): unknown {
  return Sentry.startSpan(
    {
      name: `mcp.tool.${toolName}`,
      op: 'mcp.tool',
      attributes: {
        'mcp.tool.name': toolName,
        'mcp.tool.args_count': Object.keys(args).length
      }
    },
    (span) => span
  )
}

/** Add breadcrumb for tool invocation (for debugging context) */
export function addToolBreadcrumb(toolName: string, args: Record<string, unknown> = {}): void {
  Sentry.addBreadcrumb({
    category: 'mcp.tool',
    message: `Tool invoked: ${toolName}`,
    level: 'info',
    data: {
      tool: toolName,
      args: sanitizeToolArgs(args)
    }
  })
}

/** Set MCP client context (which client is connecting) */
export function setMcpClientContext(clientInfo: {
  name: string
  version: string
  transport: string
}): void {
  Sentry.setContext('mcp_client', {
    name: clientInfo.name,
    version: clientInfo.version,
    transport: clientInfo.transport
  })

  Sentry.setTag('mcp.client', clientInfo.name)
  Sentry.setTag('mcp.transport', clientInfo.transport)
}
