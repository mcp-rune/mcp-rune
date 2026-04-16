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

import { randomUUID } from 'node:crypto'

import type { NextFunction, Request, Response } from 'express'

/** Express middleware that attaches a request ID to each request */
export function createRequestIdMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.get('X-Request-ID') || randomUUID()
    ;(req as Request & { requestId: string }).requestId = requestId
    res.set('X-Request-ID', requestId)

    next()
  }
}

export default createRequestIdMiddleware
