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
 * import { initErrorTracking, captureToolError } from '#lib/services/error-tracking.js'
 *
 * // Initialize once at startup
 * initErrorTracking({ serviceName: 'mcp-server-engineer' })
 *
 * // Capture errors
 * try {
 *   await tool.execute(args)
 * } catch (error) {
 *   captureToolError(error, 'find_model', args)
 *   throw error
 * }
 */

// Vendor implementation - change this import to switch vendors
import * as vendor from './vendor/sentry/index.js'

/**
 * Error categories for classification
 */
export const ErrorCategory = vendor.ErrorCategory

/**
 * Initialize error tracking service
 *
 * Call this once at server startup before handling requests.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.serviceName - Name of the MCP server
 * @param {string} options.version - Server version
 * @param {Object} options.extra - Additional default context
 * @returns {boolean} True if initialized successfully
 *
 * @example
 * initErrorTracking({
 *   serviceName: 'mcp-server-engineer',
 *   version: '1.0.0'
 * })
 */
export function initErrorTracking(options = {}) {
  return vendor.initialize(options)
}

/**
 * Check if error tracking is configured and enabled
 * @returns {boolean}
 */
export function isErrorTrackingEnabled() {
  return vendor.isConfigured()
}

/**
 * Capture a tool execution error
 *
 * Use this when an MCP tool fails. The error will be categorized
 * and grouped appropriately in the error tracking dashboard.
 *
 * @param {Error} error - The error that occurred
 * @param {string} toolName - Name of the MCP tool
 * @param {Object} args - Tool arguments (will be sanitized)
 * @param {Object} context - Additional context
 *
 * @example
 * catch (error) {
 *   captureToolError(error, 'create_model', { model: 'book', attributes })
 *   throw error
 * }
 */
export function captureToolError(error, toolName, args = {}, context = {}) {
  vendor.captureToolError(error, toolName, args, context)
}

/**
 * Capture an API client error
 *
 * Use this when an external API call fails.
 *
 * @param {Error} error - The error that occurred
 * @param {string} endpoint - API endpoint called
 * @param {string} method - HTTP method
 * @param {Object} context - Additional context
 */
export function captureApiError(error, endpoint, method = 'GET', context = {}) {
  vendor.captureApiError(error, endpoint, method, context)
}

/**
 * Capture a prompt execution error
 *
 * Use this when an MCP prompt fails.
 *
 * @param {Error} error - The error that occurred
 * @param {string} promptName - Name of the prompt
 * @param {Object} context - Additional context
 */
export function capturePromptError(error, promptName, context = {}) {
  vendor.capturePromptError(error, promptName, context)
}

/**
 * Capture a generic exception
 *
 * Use this for errors that don't fit into the specific categories above.
 *
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context
 * @param {Object} context.tags - Tags for filtering
 * @param {Object} context.extra - Extra data
 * @param {Object} context.user - User information
 * @param {string} context.level - Severity level
 */
export function captureException(error, context = {}) {
  vendor.captureException(error, context)
}

/**
 * Capture a message (non-error event)
 *
 * Use for important events that aren't errors but should be tracked.
 *
 * @param {string} message - Message to capture
 * @param {string} level - Severity level (info, warning, error)
 * @param {Object} context - Additional context
 */
export function captureMessage(message, level = 'info', context = {}) {
  vendor.captureMessage(message, level, context)
}

/**
 * Categorize an error for grouping
 *
 * @param {Error} error - The error to categorize
 * @returns {string} Error category
 */
export function categorizeError(error) {
  return vendor.categorizeError(error)
}

/**
 * Add a breadcrumb for debugging context
 *
 * Breadcrumbs appear in error reports to show what happened before the error.
 *
 * @param {Object} breadcrumb - Breadcrumb data
 * @param {string} breadcrumb.category - Category (e.g., 'mcp.tool', 'http')
 * @param {string} breadcrumb.message - Description
 * @param {string} breadcrumb.level - Level (info, warning, error)
 * @param {Object} breadcrumb.data - Additional data
 */
export function addBreadcrumb(breadcrumb) {
  vendor.addBreadcrumb(breadcrumb)
}

/**
 * Add a breadcrumb specifically for tool invocations
 *
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments (will be sanitized)
 */
export function addToolBreadcrumb(toolName, args = {}) {
  vendor.addToolBreadcrumb(toolName, args)
}

/**
 * Set the MCP client context
 *
 * Call this when a client connects to track which clients are using the server.
 *
 * @param {Object} clientInfo - Client information
 * @param {string} clientInfo.name - Client name (e.g., 'claude-code', 'cursor')
 * @param {string} clientInfo.version - Client version
 * @param {string} clientInfo.transport - Transport type (stdio, sse, http)
 */
export function setMcpClientContext(clientInfo) {
  vendor.setMcpClientContext(clientInfo)
}

/**
 * Set the current user context
 *
 * Call this after authentication to associate errors with users.
 *
 * @param {Object} user - User information
 * @param {string} user.id - User ID
 * @param {string} user.email - User email (optional)
 * @param {string} user.username - Username (optional)
 */
export function setUser(user) {
  vendor.setUser(user)
}

/**
 * Clear the current user context
 *
 * Call this on logout or session end.
 */
export function clearUser() {
  vendor.clearUser()
}

/**
 * Sanitize tool arguments for safe logging/reporting
 *
 * Removes sensitive fields and truncates large values.
 *
 * @param {Object} args - Tool arguments
 * @returns {Object} Sanitized arguments
 */
export function sanitizeToolArgs(args) {
  return vendor.sanitizeToolArgs(args)
}

/**
 * Flush pending error reports
 *
 * Call before process exit to ensure all errors are sent.
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function flushErrorTracking(timeout = 2000) {
  return vendor.flush(timeout)
}

/**
 * Close error tracking service
 *
 * Call on graceful shutdown.
 *
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function closeErrorTracking(timeout = 2000) {
  return vendor.close(timeout)
}
