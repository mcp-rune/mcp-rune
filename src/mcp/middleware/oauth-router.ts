/**
 * OAuth Router
 *
 * Express router that handles all OAuth-related routes for MCP servers.
 * The MCP server acts as an OAuth 2.0 Resource Server and proxies
 * Authorization Server metadata + Dynamic Client Registration to an upstream
 * authorization server. See `docs/oauth2-discovery-flow.md` for the full flow.
 *
 * RFC map:
 * - RFC 6749  OAuth 2.0 Authorization Framework     -> /oauth/authorize, /oauth/token
 * - RFC 7591  Dynamic Client Registration (DCR)     -> /oauth/register
 * - RFC 7636  PKCE                                  -> forwarded on authorize/token
 * - RFC 8414  Authorization Server Metadata         -> /.well-known/oauth-authorization-server
 * - RFC 8707  Resource Indicators                   -> forwarded as `resource` param
 * - RFC 9728  Protected Resource Metadata           -> /.well-known/oauth-protected-resource[/mcp]
 * - RFC 9111 HTTP Caching                         -> Cache-Control on CIMD metadata
 * - CIMD  Client ID Metadata Document (MCP Auth) -> /oauth/client-metadata.json
 *
 * Routes:
 * - GET  /.well-known/oauth-protected-resource      - RFC 9728 metadata (origin-only form)
 * - GET  /.well-known/oauth-protected-resource/mcp  - RFC 9728 path-inserted form (canonical)
 * - GET  /.well-known/oauth-authorization-server    - Authorization server metadata (proxy, RFC 8414)
 * - GET  /.well-known/openid-configuration          - OpenID configuration (alias)
 * - GET  /oauth/callback                            - OAuth callback landing page
 * - GET  /oauth/authorize                           - Redirect to authorization server (RFC 6749)
 * - POST /oauth/token                               - Proxy token requests (RFC 6749)
 * - POST /oauth/register                            - Proxy DCR (RFC 7591)
 * - GET  /oauth/client-metadata.json                 - CIMD metadata document (MCP Auth Spec Nov 2025)
 * - POST /mcp/m2m/token                             - Machine-to-machine token endpoint
 */

import { createHash } from 'node:crypto'
import { URLSearchParams } from 'node:url'

import type { AxiosError } from 'axios'
import axios from 'axios'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'

import type { ClientMetadataConfig } from '#src/mcp/http-server.js'
import type { OAuthService } from '#src/oauth2/service.js'
import * as logger from '#src/services/logger.js'

/** Escape HTML special characters to prevent XSS attacks */
function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Extract Bearer token from Authorization header */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7) // Remove 'Bearer ' prefix
}

/**
 * Build RFC 9728 compliant protected resource metadata URL
 *
 * Per RFC 9728 section 3.1, the well-known path is inserted between the host and
 * the resource path. This enables multiple resources per host.
 *
 * Example:
 *   Resource: https://example.com/my-mcp-server/mcp
 *   Metadata: https://example.com/.well-known/oauth-protected-resource/my-mcp-server/mcp
 */
export function buildResourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl)
  const origin = url.origin
  const path = url.pathname
  // Insert well-known path between origin and resource path
  return `${origin}/.well-known/oauth-protected-resource${path}`
}

/**
 * Send HTTP 401 Unauthorized response with WWW-Authenticate header
 *
 * Per RFC 9728 and MCP spec 2025-06-18, the WWW-Authenticate header includes
 * a resource_metadata parameter pointing to the protected resource metadata endpoint.
 */
export function sendUnauthorized(req: Request, res: Response, baseUrl: string): void {
  // Determine the resource URL based on which endpoint was accessed
  const isMcpEndpoint = req.path.endsWith('/mcp')
  const resourceUrl = isMcpEndpoint ? `${baseUrl}/mcp` : baseUrl
  const resourceMetadataUrl = buildResourceMetadataUrl(resourceUrl)

  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`)
  res.status(401).json({
    error: 'unauthorized',
    error_description:
      'Authentication required. See WWW-Authenticate header for authorization server details.'
  })
}

interface OAuthRouterConfig {
  oauth: OAuthService
  baseUrl: string
  mcpName: string
  clientMetadata?: ClientMetadataConfig
  /**
   * Whether this router should serve the RFC 9728 Protected Resource Metadata
   * endpoints itself. Set to `false` when the framework is mounted under a
   * non-root path prefix: `.well-known` URIs are origin-scoped, so they can
   * only be served from the origin root by an upstream reverse proxy. The
   * `WWW-Authenticate` header still points at the correct origin-rooted URL
   * via `buildResourceMetadataUrl()` regardless of this flag.
   */
  serveProtectedResourceMetadata?: boolean
}

/** Create OAuth router with all OAuth-related routes */
export function createOAuthRouter({
  oauth,
  baseUrl,
  mcpName,
  clientMetadata,
  serveProtectedResourceMetadata = true
}: OAuthRouterConfig): Router {
  const router = Router()

  // Extract origin from baseUrl for authorization_servers
  const origin = new URL(baseUrl).origin

  /** Wrap async route handlers to catch errors and forward to error middleware */
  const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next)
    }

  /**
   * RFC 9728: OAuth 2.0 Protected Resource Metadata
   *
   * We register BOTH forms with the same handler:
   *   1. `/.well-known/oauth-protected-resource`      - origin-only (legacy / MCP Inspector fallback)
   *   2. `/.well-known/oauth-protected-resource/mcp`  - RFC 9728 section 3.1 canonical
   *
   * When `serveProtectedResourceMetadata` is false (path-prefixed deploys),
   * we skip registration entirely: the framework cannot serve these at the
   * origin root from inside a sub-path, so the upstream reverse proxy owns
   * them. See `docs/guides/oauth2-discovery-flow.md` for the deployment
   * pattern.
   */
  if (serveProtectedResourceMetadata) {
    const protectedResourceHandler = (_req: Request, res: Response): void => {
      logger.info('Protected resource metadata requested', {
        service: mcpName
      })
      res.json({
        resource: `${baseUrl}/mcp`,
        authorization_servers: [origin]
      })
    }
    router.get('/.well-known/oauth-protected-resource', protectedResourceHandler)
    router.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler)
  }

  /**
   * Proxy for OAuth 2.0 Authorization Server Metadata
   *
   * Fetches metadata from authorization server and rewrites OAuth endpoint URLs
   * to point to this MCP server.
   */
  router.get(
    '/.well-known/oauth-authorization-server',
    asyncHandler(async (_req: Request, res: Response) => {
      try {
        const response = await axios.get(
          `${oauth.authServerUrl}/.well-known/oauth-authorization-server`
        )

        // Rewrite OAuth endpoint URLs to point to this MCP server
        const metadata = { ...response.data } as Record<string, unknown>
        const mcpOAuthBase = `${baseUrl}/oauth`

        metadata.authorization_endpoint = `${mcpOAuthBase}/authorize`
        metadata.token_endpoint = `${mcpOAuthBase}/token`
        metadata.registration_endpoint = `${mcpOAuthBase}/register`

        // Keep other endpoints pointing to authorization server if they exist
        if (metadata.revocation_endpoint) {
          metadata.revocation_endpoint = `${oauth.authServerUrl}/oauth/revoke`
        }
        if (metadata.introspection_endpoint) {
          metadata.introspection_endpoint = `${oauth.authServerUrl}/oauth/introspect`
        }

        logger.info('Authorization server metadata proxied', {
          service: mcpName
        })

        res.json(metadata)
      } catch (err) {
        const error = err as Error
        logger.error('Failed to fetch authorization server metadata', {
          service: mcpName,
          error: error.message
        })
        res.status(502).json({
          error: 'Failed to fetch authorization server metadata'
        })
      }
    })
  )

  // OpenID configuration - Claude Desktop looks for this
  router.get(
    '/.well-known/openid-configuration',
    asyncHandler(async (_req: Request, res: Response) => {
      try {
        const response = await axios.get(
          `${oauth.authServerUrl}/.well-known/oauth-authorization-server`
        )

        const metadata = { ...response.data } as Record<string, unknown>
        const mcpOAuthBase = `${baseUrl}/oauth`

        metadata.authorization_endpoint = `${mcpOAuthBase}/authorize`
        metadata.token_endpoint = `${mcpOAuthBase}/token`
        metadata.registration_endpoint = `${mcpOAuthBase}/register`

        if (metadata.revocation_endpoint) {
          metadata.revocation_endpoint = `${oauth.authServerUrl}/oauth/revoke`
        }
        if (metadata.introspection_endpoint) {
          metadata.introspection_endpoint = `${oauth.authServerUrl}/oauth/introspect`
        }

        logger.info('OpenID configuration proxied', {
          service: mcpName
        })

        res.json(metadata)
      } catch (err) {
        const error = err as Error
        logger.error('Failed to fetch authorization server metadata', {
          service: mcpName,
          error: error.message
        })
        res.status(502).json({
          error: 'Failed to fetch authorization server metadata'
        })
      }
    })
  )

  /** OAuth2 callback - landing page after authorization server authentication */
  router.get(
    '/oauth/callback',
    asyncHandler(async (req: Request, res: Response) => {
      const { error, error_description } = req.query as Record<string, string | undefined>

      if (error) {
        logger.error('OAuth2 callback error', {
          service: mcpName,
          error,
          error_description
        })
        // Escape user-controlled input to prevent XSS attacks
        const safeMessage = escapeHtml(error_description || error)
        res.status(400).send(`
        <html><body>
          <h1>Authentication Failed</h1>
          <p>${safeMessage}</p>
        </body></html>
      `)
        return
      }

      logger.info('OAuth2 callback successful', {
        service: mcpName
      })

      res.send(`
      <html><body>
        <h1>Authentication Successful</h1>
        <p>You can close this window and return to your application.</p>
      </body></html>
    `)
    })
  )

  /** OAuth2 Authorization Endpoint - Redirect to authorization server */
  router.get('/oauth/authorize', (req: Request, res: Response) => {
    // OAuth 2.1 §4.1.1: Only response_type=code is permitted (implicit grant removed)
    const responseType = req.query.response_type as string | undefined
    if (responseType && responseType !== 'code') {
      res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported (OAuth 2.1)'
      })
      return
    }

    const targetUrl = new URL(`${oauth.authServerUrl}/oauth/authorize`)

    // Forward all query parameters to the authorization server
    Object.entries(req.query).forEach(([key, value]) => {
      targetUrl.searchParams.set(key, value as string)
    })

    logger.info('Redirecting OAuth authorize to authorization server', {
      service: mcpName,
      clientId: req.query.client_id
    })

    res.redirect(targetUrl.toString())
  })

  /** OAuth2 Token Endpoint - Proxy to authorization server */
  router.post(
    '/oauth/token',
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const response = await axios.post(`${oauth.authServerUrl}/oauth/token`, req.body, {
          headers: {
            'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
            ...(req.headers.authorization && {
              Authorization: req.headers.authorization
            })
          },
          transformRequest: [
            (data: unknown) => {
              if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
                return new URLSearchParams(data as Record<string, string>).toString()
              }
              return data
            }
          ]
        })

        logger.info('OAuth token request proxied successfully', {
          service: mcpName,
          grantType: (req.body as Record<string, unknown> | undefined)?.grant_type
        })

        res.json(response.data)
      } catch (err) {
        const axiosErr = err as AxiosError
        const status = axiosErr.response?.status || 500
        const data = axiosErr.response?.data || { error: 'server_error' }

        logger.error('OAuth token request failed', {
          service: mcpName,
          error: axiosErr.message,
          status
        })

        res.status(status).json(data)
      }
    })
  )

  /**
   * OAuth2 Dynamic Client Registration (DCR) - Proxy to authorization server
   * RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol
   */
  router.post(
    '/oauth/register',
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const response = await axios.post(`${oauth.authServerUrl}/oauth/register`, req.body, {
          headers: {
            'Content-Type': 'application/json',
            ...(req.headers.authorization && {
              Authorization: req.headers.authorization
            })
          }
        })

        logger.info('OAuth client registration proxied successfully', {
          service: mcpName,
          clientName: (req.body as Record<string, unknown> | undefined)?.client_name
        })

        res.status(response.status).json(response.data)
      } catch (err) {
        const axiosErr = err as AxiosError
        const status = axiosErr.response?.status || 500
        const data = axiosErr.response?.data || { error: 'server_error' }

        logger.error('OAuth client registration failed', {
          service: mcpName,
          error: axiosErr.message,
          status
        })

        res.status(status).json(data)
      }
    })
  )

  /**
   * Client ID Metadata Document (CIMD)
   *
   * MCP Authorization Spec (November 2025): Clients can use an HTTPS URL
   * as their client_id. The authorization server fetches the JSON metadata
   * document from that URL to register the client automatically.
   *
   * This endpoint serves the metadata document so this MCP server can be
   * used as a CIMD client_id with any compliant authorization server.
   */
  router.get('/oauth/client-metadata.json', (_req: Request, res: Response) => {
    const metadataUrl = `${baseUrl}/oauth/client-metadata.json`

    logger.info('CIMD metadata document requested', {
      service: mcpName,
      clientId: metadataUrl
    })

    const body = {
      client_id: metadataUrl,
      client_name: clientMetadata?.clientName || mcpName,
      redirect_uris: clientMetadata?.redirectUris || [`${baseUrl}/oauth/callback`],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: clientMetadata?.scope || oauth.scopes
    }

    // RFC 9111: Cache headers so authorization servers know when to re-fetch.
    // IETF Client ID Metadata Document draft: servers SHOULD respect these.
    const maxAge = clientMetadata?.cacheMaxAge ?? 3600
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}"`

    res.setHeader('Cache-Control', `public, max-age=${maxAge}`)
    res.setHeader('ETag', etag)
    res.json(body)
  })

  /** Machine-to-Machine token endpoint - Client Credentials grant */
  router.post(
    '/mcp/m2m/token',
    asyncHandler(async (_req: Request, res: Response) => {
      try {
        const tokenResponse = await oauth.getClientCredentialsToken()

        logger.info('M2M token issued', {
          service: mcpName,
          expiresIn: tokenResponse.expires_in
        })

        res.json(tokenResponse)
      } catch (err) {
        const error = err as Error & { code?: string }
        logger.error('M2M token request failed', {
          service: mcpName,
          error: error.message
        })

        // Handle common OAuth2 errors
        if (error.code === 'invalid_client') {
          res.status(401).json({
            error: 'invalid_client',
            error_description: 'Client authentication failed. Check OAuth2 credentials.'
          })
          return
        }

        if (error.code === 'unauthorized_client') {
          res.status(403).json({
            error: 'unauthorized_client',
            error_description:
              'Client is not authorized for Client Credentials grant. Enable this grant type in authorization server.'
          })
          return
        }

        res.status(500).json({
          error: 'server_error',
          error_description: 'Failed to obtain access token'
        })
      }
    })
  )

  return router
}

export default createOAuthRouter
