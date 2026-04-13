/**
 * Request ID Middleware
 *
 * Enables distributed tracing across services by ensuring every request
 * has a unique identifier that propagates through the entire request chain.
 *
 * - Uses incoming X-Request-ID header if present (from upstream services)
 * - Generates UUID v4 if not present
 * - Sets X-Request-ID response header for downstream correlation
 */

import { randomUUID } from 'crypto'

/**
 * Create request ID middleware
 * @returns {Function} Express middleware
 */
export function createRequestIdMiddleware() {
  return (req, res, next) => {
    const requestId = req.get('X-Request-ID') || randomUUID()
    req.requestId = requestId
    res.set('X-Request-ID', requestId)

    next()
  }
}

export default createRequestIdMiddleware
