/**
 * Error Tracking Service - Vendor-Agnostic Public API
 *
 * This module provides a stable API for error tracking that abstracts
 * the underlying vendor implementation (currently Sentry).
 *
 * To switch vendors, update the import and ensure the vendor module
 * exports the same interface.
 *
 * @example
 * import { initErrorTracking, captureToolError } from '#src/runtime/error-tracking.js'
 *
 * // Initialize once at startup
 * initErrorTracking({ serviceName: 'mcp-server-engineer' })
 *
 * // Capture errors
 * try {
 *   await tool.execute(args)
 * } catch (error) {
 *   captureToolError(error, 'find_records', args)
 *   throw error
 * }
 */

// Vendor implementation - change this import to switch vendors
import * as vendor from './vendor/sentry/index.js'

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
export const ErrorCategory = vendor.ErrorCategory

/**
 * Initialize error tracking service
 *
 * Call this once at server startup before handling requests.
 *
 * @example
 * initErrorTracking({
 *   serviceName: 'mcp-server-engineer',
 *   version: '1.0.0'
 * })
 */
export function initErrorTracking(options: ErrorTrackingOptions = {}): boolean {
  return vendor.initialize(options)
}

/** Check if error tracking is configured and enabled */
export function isErrorTrackingEnabled(): boolean {
  return vendor.isConfigured()
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
  vendor.captureToolError(error, toolName, args, context)
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
  vendor.captureApiError(error, endpoint, method, context)
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
  vendor.capturePromptError(error, promptName, context)
}

/**
 * Capture a generic exception
 *
 * Use this for errors that don't fit into the specific categories above.
 */
export function captureException(error: Error, context: ExceptionContext = {}): void {
  vendor.captureException(error, context)
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
  vendor.captureMessage(message, level, context)
}

/** Categorize an error for grouping */
export function categorizeError(error: Error): string {
  return vendor.categorizeError(error)
}

/**
 * Add a breadcrumb for debugging context
 *
 * Breadcrumbs appear in error reports to show what happened before the error.
 */
export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  vendor.addBreadcrumb(breadcrumb)
}

/** Add a breadcrumb specifically for tool invocations */
export function addToolBreadcrumb(toolName: string, args: Record<string, unknown> = {}): void {
  vendor.addToolBreadcrumb(toolName, args)
}

/**
 * Set the MCP client context
 *
 * Call this when a client connects to track which clients are using the server.
 */
export function setMcpClientContext(clientInfo: ClientInfo): void {
  vendor.setMcpClientContext(clientInfo)
}

/**
 * Set the current user context
 *
 * Call this after authentication to associate errors with users.
 */
export function setUser(user: UserInfo): void {
  vendor.setUser(user)
}

/**
 * Clear the current user context
 *
 * Call this on logout or session end.
 */
export function clearUser(): void {
  vendor.clearUser()
}

/** Sanitize tool arguments for safe logging/reporting */
export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  return vendor.sanitizeToolArgs(args)
}

/**
 * Flush pending error reports
 *
 * Call before process exit to ensure all errors are sent.
 */
export async function flushErrorTracking(timeout = 2000): Promise<boolean> {
  return vendor.flush(timeout)
}

/**
 * Close error tracking service
 *
 * Call on graceful shutdown.
 */
export async function closeErrorTracking(timeout = 2000): Promise<boolean> {
  return vendor.close(timeout)
}
