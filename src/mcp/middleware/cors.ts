/**
 * CORS Middleware
 *
 * Wraps `cors` with the MCP-specific allowed-methods/headers list and the
 * production safety check: if `CORS_ORIGINS` is unset in production we log
 * a loud warning and block all cross-origin requests, since allowing any
 * origin against a token-bearing endpoint is a serious foot-gun.
 */

import cors from 'cors'
import type { NextFunction, Request, Response } from 'express'

import * as logger from '#src/services/logger.js'

export interface CorsOptions {
  /** Comma-separated allow-list. Trimmed and split internally. */
  corsOrigins: string | undefined
  isProduction: boolean
  /** Service name used in the "no CORS in production" warning. */
  serviceName: string
}

export function createCorsMiddleware({
  corsOrigins,
  isProduction,
  serviceName
}: CorsOptions): (req: Request, res: Response, next: NextFunction) => void {
  const corsOriginsList = corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : undefined

  let corsOriginConfig: string[] | boolean | undefined
  if (corsOriginsList) {
    corsOriginConfig = corsOriginsList
  } else if (isProduction) {
    logger.warn('CORS_ORIGINS not set in production -- cross-origin requests will be blocked', {
      service: serviceName
    })
    corsOriginConfig = false
  } else {
    corsOriginConfig = true
  }

  return cors({
    origin: corsOriginConfig,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Request-ID',
      'Mcp-Session-Id',
      'MCP-Protocol-Version'
    ],
    exposedHeaders: ['mcp-session-id', 'X-Request-ID']
  })
}
