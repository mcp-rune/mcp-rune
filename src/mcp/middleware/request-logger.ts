/**
 * Request Logger Middleware
 *
 * Logs HTTP requests with structured JSON output for Loki/Grafana integration.
 * Includes request ID for distributed tracing correlation.
 */

import * as logger from '#src/services/logger.js'
import type { Request, Response, NextFunction } from 'express'

/** Express middleware that logs request start/finish with timing */
export function createRequestLoggerMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now()
    const { method, path } = req
    const requestId = (req as Request & { requestId?: string }).requestId

    // Log request start with payload for POST/PUT/PATCH
    const startLogData: Record<string, unknown> = { service: 'express', method, path, requestId }
    if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
      startLogData.body = req.body
    }
    logger.info('Request started', startLogData)

    res.on('finish', () => {
      const duration = Date.now() - start
      const { statusCode } = res

      const logData = {
        service: 'express',
        method,
        path,
        statusCode,
        duration: `${duration}ms`,
        requestId
      }

      if (statusCode >= 500) {
        logger.error('Request failed', logData)
      } else if (statusCode >= 400) {
        logger.warn('Request error', logData)
      } else {
        logger.info('Request completed', logData)
      }
    })

    next()
  }
}

export default createRequestLoggerMiddleware
