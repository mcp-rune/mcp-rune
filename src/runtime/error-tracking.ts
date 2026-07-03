/**
 * Error Tracking Service — stable public API over the Sentry integration.
 *
 * The `integrations/sentry` module is an anti-corruption facade over the
 * `@sentry/node` npm package (not vendored source). The facade injects the
 * shared `sanitizers` redaction into every event's `beforeSend`, turns
 * capture into a no-op when no DSN is configured (graceful-disable), and
 * keeps this module's surface stable across Sentry major versions. See
 * ADR 0005.
 *
 * @example
 * import { initErrorTracking, captureToolError } from '#src/runtime/error-tracking.js'
 *
 * // Initialize once at startup
 * initErrorTracking({ serviceName: 'my-mcp-server' })
 *
 * // Capture errors
 * try {
 *   await tool.execute(args)
 * } catch (error) {
 *   captureToolError(error, 'find_records', args)
 *   throw error
 * }
 */

import * as integration from './integrations/sentry/index.js'

export interface ErrorTrackingOptions {
  serviceName?: string
  version?: string
  extra?: Record<string, unknown>
}

export interface ExceptionContext {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  user?: { id?: string; email?: string; username?: string }
  level?: string
}

export interface Breadcrumb {
  category?: string
  message?: string
  level?: 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'
  data?: Record<string, unknown>
}

export interface ClientInfo {
  name: string
  version: string
  transport: string
}

export interface UserInfo {
  id: string
  email?: string
  username?: string
}

/** Error categories for classification */
export const ErrorCategory = integration.ErrorCategory

/**
 * Initialize error tracking service
 *
 * Call this once at server startup before handling requests.
 *
 * @example
 * initErrorTracking({
 *   serviceName: 'my-mcp-server',
 *   version: '1.0.0'
 * })
 */
export function initErrorTracking(options: ErrorTrackingOptions = {}): boolean {
  return integration.initialize(options)
}

/** Check if error tracking is configured and enabled */
export function isErrorTrackingEnabled(): boolean {
  return integration.isConfigured()
}

/**
 * Capture a tool execution error
 *
 * Use this when an MCP tool fails. The error will be categorized
 * and grouped appropriately in the error tracking dashboard.
 *
 * @example
 * catch (error) {
 *   captureToolError(error, 'create_model', { model: 'book', attributes })
 *   throw error
 * }
 */
export function captureToolError(
  error: Error,
  toolName: string,
  args: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
): void {
  integration.captureToolError(error, toolName, args, context)
}

/**
 * Capture an API client error
 *
 * Use this when an external API call fails.
 */
export function captureApiError(
  error: Error,
  endpoint: string,
  method = 'GET',
  context: Record<string, unknown> = {}
): void {
  integration.captureApiError(error, endpoint, method, context)
}

/**
 * Capture a prompt execution error
 *
 * Use this when an MCP prompt fails.
 */
export function capturePromptError(
  error: Error,
  promptName: string,
  context: Record<string, unknown> = {}
): void {
  integration.capturePromptError(error, promptName, context)
}

/**
 * Capture a generic exception
 *
 * Use this for errors that don't fit into the specific categories above.
 */
export function captureException(error: Error, context: ExceptionContext = {}): void {
  integration.captureException(error, context)
}

/**
 * Capture a message (non-error event)
 *
 * Use for important events that aren't errors but should be tracked.
 */
export function captureMessage(
  message: string,
  level = 'info',
  context: ExceptionContext = {}
): void {
  integration.captureMessage(message, level, context)
}

/** Categorize an error for grouping */
export function categorizeError(error: Error): string {
  return integration.categorizeError(error)
}

/**
 * Add a breadcrumb for debugging context
 *
 * Breadcrumbs appear in error reports to show what happened before the error.
 */
export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  integration.addBreadcrumb(breadcrumb)
}

/** Add a breadcrumb specifically for tool invocations */
export function addToolBreadcrumb(toolName: string, args: Record<string, unknown> = {}): void {
  integration.addToolBreadcrumb(toolName, args)
}

/**
 * Set the MCP client context
 *
 * Call this when a client connects to track which clients are using the server.
 */
export function setMcpClientContext(clientInfo: ClientInfo): void {
  integration.setMcpClientContext(clientInfo)
}

/**
 * Set the current user context
 *
 * Call this after authentication to associate errors with users.
 */
export function setUser(user: UserInfo): void {
  integration.setUser(user)
}

/**
 * Clear the current user context
 *
 * Call this on logout or session end.
 */
export function clearUser(): void {
  integration.clearUser()
}

/** Sanitize tool arguments for safe logging/reporting */
export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  return integration.sanitizeToolArgs(args)
}

/**
 * Flush pending error reports
 *
 * Call before process exit to ensure all errors are sent.
 */
export async function flushErrorTracking(timeout = 2000): Promise<boolean> {
  return integration.flush(timeout)
}

/**
 * Close error tracking service
 *
 * Call on graceful shutdown.
 */
export async function closeErrorTracking(timeout = 2000): Promise<boolean> {
  return integration.close(timeout)
}
