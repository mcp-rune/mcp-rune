/**
 * MCP Authentication Middleware
 *
 * Resolves the access token used for downstream API calls and gates the MCP
 * endpoint accordingly. Two modes:
 *
 * - **OAuth mode**: extracts the Bearer token, introspects it, and rejects
 *   inactive tokens with a 401 carrying `WWW-Authenticate` (via
 *   `sendUnauthorized` from oauth-router).
 * - **Token mode**: no per-request auth; attaches the static token that
 *   was configured at startup.
 *
 * In *either* mode, an `access_token` URI query parameter is rejected with
 * a 400. OAuth 2.1 §5.1.2 prohibits this transport because it leaks tokens
 * into logs and the browser history.
 *
 * On success the resolved token is attached to `req.requestAccessToken` so
 * the downstream MCP handler does not have to re-derive it. The session
 * map (when present) is consulted later by the handler for OAuth token
 * refresh detection.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express'

import type { OAuthService } from '#src/oauth2/service.js'
import * as logger from '#src/runtime/logger.js'

import { extractBearerToken, sendUnauthorized } from './oauth-router.js'

export interface McpAuthOptions {
  oauth: OAuthService | null
  /** Static token used when oauth is null (token mode). */
  accessToken: string | null
  /** Public base URL — passed to `sendUnauthorized` for the WWW-Authenticate header. */
  baseUrl: string
  serviceName: string
}

/** Request augmented by this middleware. */
export interface AuthenticatedMcpRequest extends Request {
  requestId?: string
  requestAccessToken?: string | null
}

export function createMcpAuthMiddleware({
  oauth,
  accessToken,
  baseUrl,
  serviceName
}: McpAuthOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.query.access_token) {
      res.status(400).json({
        error: 'invalid_request',
        error_description:
          'Bearer tokens in URI query parameters are not allowed (OAuth 2.1 §5.1.2)'
      })
      return
    }

    const authReq = req as AuthenticatedMcpRequest

    if (oauth) {
      const bearerToken = extractBearerToken(req)
      if (!bearerToken) {
        logger.info('No Bearer token in request', {
          service: serviceName,
          method: req.method,
          requestId: authReq.requestId
        })
        sendUnauthorized(req, res, baseUrl)
        return
      }

      const introspection = await oauth.introspectToken(bearerToken)
      if (!introspection.active) {
        logger.info('Token introspection failed - token inactive', {
          service: serviceName,
          method: req.method,
          requestId: authReq.requestId
        })
        sendUnauthorized(req, res, baseUrl)
        return
      }

      authReq.requestAccessToken = bearerToken
    } else {
      authReq.requestAccessToken = accessToken
    }

    next()
  }
}
