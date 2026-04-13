/**
 * Data sanitization utilities (vendor-agnostic)
 *
 * Removes sensitive data before sending to external services.
 * Used by both error tracking (Sentry) and tracing (Langfuse).
 */

/**
 * Fields that should never be sent to external services
 */
const SENSITIVE_FIELDS = [
  'authorization',
  'password',
  'secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'privateKey',
  'private_key',
  'credential',
  'ssn',
  'credit_card',
  'creditCard'
]

/**
 * Headers that should be redacted
 */
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-access-token']

/**
 * Sanitize an object by removing sensitive fields
 * @param {Object} obj - Object to sanitize
 * @param {number} depth - Current recursion depth
 * @param {number} maxDepth - Maximum recursion depth
 * @returns {Object} Sanitized object
 */
export function sanitizeObject(obj, depth = 0, maxDepth = 5) {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1, maxDepth))
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase()
    const isSensitiveKey = SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))

    if (typeof value === 'object' && value !== null) {
      // Always recurse into objects, even if the key looks sensitive
      // This allows nested objects like "credentials" to have their children sanitized
      sanitized[key] = sanitizeObject(value, depth + 1, maxDepth)
    } else if (isSensitiveKey) {
      // Only redact primitive values with sensitive keys
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Sanitize HTTP headers
 * @param {Object} headers - Headers object
 * @returns {Object} Sanitized headers
 */
export function sanitizeHeaders(headers) {
  if (!headers) return headers

  const sanitized = { ...headers }
  for (const header of SENSITIVE_HEADERS) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]'
    }
    // Also check lowercase versions
    const lowerHeader = header.toLowerCase()
    if (sanitized[lowerHeader]) {
      sanitized[lowerHeader] = '[REDACTED]'
    }
  }

  return sanitized
}

/**
 * Sanitize tool arguments before sending to external services
 * @param {Object} args - Tool arguments
 * @returns {Object} Sanitized arguments
 */
export function sanitizeToolArgs(args) {
  if (!args) return {}

  const sanitized = sanitizeObject(args)

  // Additionally truncate large values
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 1000) + '... [truncated]'
    }
  }

  return sanitized
}
