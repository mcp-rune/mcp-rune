/**
 * Request Logger Middleware
 *
 * Logs inbound HTTP requests with one line per completed request:
 *
 *   ← [200] POST /oauth/token 157ms       grantType=authorization_code
 *
 * The bracketed status code is colorized at format time (green 2xx,
 * cyan 3xx, yellow 4xx, red 5xx). Upstream timing — when the request
 * triggered at least one outbound call — moves to the logfmt tail
 * (`upstreamMs=132 upstreamCalls=1`) where it sits with other dim
 * metadata. Proxy overhead = total − upstreamMs.
 *
 * Slow requests get a deferred `▸ METHOD path` line after
 * DEFERRED_START_MS so a stalled request doesn't look like a hang.
 *
 * Per-path domain context (e.g. `grantType` for `/oauth/token`) is
 * extracted from `req.body` via an allowlist shared with the outbound
 * interceptor's redaction/extraction logic.
 */

import type { NextFunction, Request, Response } from 'express'

import {
  type EndpointLogConfig,
  extractFields,
  matchEndpointConfig
} from '#src/runtime/instrumented-axios.js'
import * as logger from '#src/runtime/logger.js'
import { getUpstream } from '#src/runtime/request-context.js'

const DEFERRED_START_MS = 1000
const SERVICE = 'express'

const INBOUND_ENDPOINT_LOGS: EndpointLogConfig[] = [
  {
    pattern: /\/oauth\/token$/,
    req: ['grant_type', 'resource']
  },
  {
    pattern: /\/oauth\/register$/,
    req: ['client_name']
  }
]

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
}

function formatLine(method: string, path: string, status: number, totalMs: number): string {
  return `← [${status}] ${method} ${path} ${formatDuration(totalMs)}`
}

/** Express middleware that logs one line per request on `res.finish`. */
export function createRequestLoggerMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now()
    const { method, path } = req

    const startTimer = setTimeout(() => {
      logger.info(`▸ ${method} ${path}`, { service: SERVICE })
    }, DEFERRED_START_MS)
    startTimer.unref()

    res.on('finish', () => {
      clearTimeout(startTimer)
      const totalMs = Date.now() - start
      const { statusCode } = res
      const upstream = getUpstream()
      const upstreamMs = upstream?.totalMs ?? 0
      const upstreamCalls = upstream?.calls ?? 0

      const matched = matchEndpointConfig(INBOUND_ENDPOINT_LOGS, path)
      const fields = extractFields(matched, req.body, undefined)

      const meta: Record<string, unknown> = {
        service: SERVICE,
        durationMs: totalMs,
        status: statusCode,
        ...(upstreamCalls > 0 && { upstreamMs, upstreamCalls }),
        ...fields
      }

      const message = formatLine(method, path, statusCode, totalMs)

      if (statusCode >= 500) {
        logger.error(message, meta)
      } else if (statusCode >= 400) {
        logger.warn(message, meta)
      } else {
        logger.info(message, meta)
      }
    })

    next()
  }
}

export default createRequestLoggerMiddleware
