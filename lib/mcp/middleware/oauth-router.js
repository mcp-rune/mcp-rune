/**
 * OAuth Router
 *
 * Express router that handles all OAuth-related routes for MCP servers.
 * The MCP server acts as an OAuth 2.0 Resource Server and proxies
 * Authorization Server metadata + Dynamic Client Registration to an upstream
 * Identity server. See `docs/oauth2-discovery-flow.md` for the full flow.
 *
 * RFC map:
 * - RFC 6749  OAuth 2.0 Authorization Framework     → /oauth/authorize, /oauth/token
 * - RFC 7591  Dynamic Client Registration (DCR)     → /oauth/register
 * - RFC 7636  PKCE                                  → forwarded on authorize/token
 * - RFC 8414  Authorization Server Metadata         → /.well-known/oauth-authorization-server
 * - RFC 8707  Resource Indicators                   → forwarded as `resource` param
 * - RFC 9728  Protected Resource Metadata (§3.1)    → /.well-known/oauth-protected-resource[/mcp]
 *
 * Routes:
 * - GET  /.well-known/oauth-protected-resource      - RFC 9728 metadata (origin-only form)
 * - GET  /.well-known/oauth-protected-resource/mcp  - RFC 9728 §3.1 path-inserted form (canonical
 *                                                     for the resource `${baseUrl}/mcp`, and the
 *                                                     URL advertised in the `WWW-Authenticate`
 *                                                     header issued by `sendUnauthorized()`)
 * - GET  /.well-known/oauth-authorization-server    - Authorization server metadata (proxy, RFC 8414)
 * - GET  /.well-known/openid-configuration          - OpenID configuration (alias)
 * - GET  /oauth/callback                            - OAuth callback landing page
 * - GET  /oauth/authorize                           - Redirect to Identity server (RFC 6749)
 * - POST /oauth/token                               - Proxy token requests (RFC 6749)
 * - POST /oauth/register                            - Proxy DCR (RFC 7591)
 * - POST /mcp/m2m/token                             - Machine-to-machine token endpoint
 */

import { Router } from 'express'
import { URLSearchParams } from 'url'
import axios from 'axios'
import * as logger from '#lib/services/logger.js'

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} str - String to escape
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Extract Bearer token from Authorization header
 * @param {import('express').Request} req - Express request object
 * @returns {string|null} Bearer token or null
 */
export function extractBearerToken(req) {
  const authHeader = req.headers['authorization']
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7) // Remove 'Bearer ' prefix
}

/**
 * Build RFC 9728 compliant protected resource metadata URL
 *
 * Per RFC 9728 §3.1, the well-known path is inserted between the host and
 * the resource path. This enables multiple resources per host.
 *
 * Example:
 *   Resource: https://dsaenz.dev/engineer-mcp/mcp
 *   Metadata: https://dsaenz.dev/.well-known/oauth-protected-resource/engineer-mcp/mcp
 *
 * @param {string} resourceUrl - The resource URL (e.g., baseUrl or baseUrl/mcp)
 * @returns {string} The RFC 9728 compliant metadata URL
 * @see https://datatracker.ietf.org/doc/html/rfc9728#section-3.1
 */
export function buildResourceMetadataUrl(resourceUrl) {
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
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {string} baseUrl - Base URL of the MCP server
 */
export function sendUnauthorized(req, res, baseUrl) {
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

/**
 * Create OAuth router with all OAuth-related routes
 *
 * @param {Object} config
 * @param {import('#lib/oauth2/service.js').OAuthService} config.oauth - OAuth service instance
 * @param {string} config.baseUrl - Base URL for this server
 * @param {string} config.mcpName - MCP server name for logging
 * @returns {Router} Express router
 */
export function createOAuthRouter({ oauth, baseUrl, mcpName }) {
  const router = Router()

  // Extract origin from baseUrl for authorization_servers
  const origin = new URL(baseUrl).origin

  /**
   * Wrap async route handlers to catch errors and forward to error middleware
   */
  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

  /**
   * RFC 9728: OAuth 2.0 Protected Resource Metadata
   * https://datatracker.ietf.org/doc/html/rfc9728
   *
   * Per RFC 9728 §3.1, for a resource with a non-root path (`${baseUrl}/mcp`),
   * the canonical metadata URL is built by inserting `.well-known/oauth-protected-resource`
   * between the origin and the resource path — i.e. `${origin}/.well-known/oauth-protected-resource/mcp`.
   * That is the URL `buildResourceMetadataUrl()` constructs and `sendUnauthorized()`
   * advertises in the `WWW-Authenticate: Bearer resource_metadata="..."` header.
   *
   * We register BOTH forms with the same handler:
   *   1. `/.well-known/oauth-protected-resource`      — origin-only (legacy / MCP Inspector fallback)
   *   2. `/.well-known/oauth-protected-resource/mcp`  — RFC 9728 §3.1 canonical
   *
   * Rationale:
   * - Serving the §3.1 form makes the server internally consistent with its own
   *   `WWW-Authenticate` header, so strict clients that follow the
   *   `resource_metadata` parameter verbatim (as recommended by MCP spec 2025-06-18)
   *   do not 404.
   * - Serving the origin-only form covers MCP Inspector's fallback behavior. Inspector
   *   falls back from the path-suffixed URL to the origin-only URL when the former
   *   404s. This fallback is NOT required by RFC 9728 — it is an Inspector-specific
   *   convenience. Do not rely on it in new client implementations.
   * - The `/mcp` path suffix is hardcoded because `sendUnauthorized()` already
   *   hardcodes `${baseUrl}/mcp` as the resource URL. If the MCP endpoint path is
   *   ever parameterized, update both call sites together.
   */
  const protectedResourceHandler = (req, res) => {
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

  /**
   * Proxy for OAuth 2.0 Authorization Server Metadata
   *
   * Fetches metadata from Identity server and rewrites OAuth endpoint URLs
   * to point to this MCP server.
   */
  router.get(
    '/.well-known/oauth-authorization-server',
    asyncHandler(async (req, res) => {
      try {
        const response = await axios.get(
          `${oauth.identityUrl}/.well-known/oauth-authorization-server`
        )

        // Rewrite OAuth endpoint URLs to point to this MCP server
        const metadata = { ...response.data }
        const mcpOAuthBase = `${baseUrl}/oauth`

        metadata.authorization_endpoint = `${mcpOAuthBase}/authorize`
        metadata.token_endpoint = `${mcpOAuthBase}/token`
        metadata.registration_endpoint = `${mcpOAuthBase}/register`

        // Keep other endpoints pointing to Identity if they exist
        if (metadata.revocation_endpoint) {
          metadata.revocation_endpoint = `${oauth.identityUrl}/oauth/revoke`
        }
        if (metadata.introspection_endpoint) {
          metadata.introspection_endpoint = `${oauth.identityUrl}/oauth/introspect`
        }

        logger.info('Authorization server metadata proxied', {
          service: mcpName
        })

        res.json(metadata)
      } catch (err) {
        logger.error('Failed to fetch authorization server metadata', {
          service: mcpName,
          error: err.message
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
    asyncHandler(async (req, res) => {
      try {
        const response = await axios.get(
          `${oauth.identityUrl}/.well-known/oauth-authorization-server`
        )

        const metadata = { ...response.data }
        const mcpOAuthBase = `${baseUrl}/oauth`

        metadata.authorization_endpoint = `${mcpOAuthBase}/authorize`
        metadata.token_endpoint = `${mcpOAuthBase}/token`
        metadata.registration_endpoint = `${mcpOAuthBase}/register`

        if (metadata.revocation_endpoint) {
          metadata.revocation_endpoint = `${oauth.identityUrl}/oauth/revoke`
        }
        if (metadata.introspection_endpoint) {
          metadata.introspection_endpoint = `${oauth.identityUrl}/oauth/introspect`
        }

        logger.info('OpenID configuration proxied', {
          service: mcpName
        })

        res.json(metadata)
      } catch (err) {
        logger.error('Failed to fetch authorization server metadata', {
          service: mcpName,
          error: err.message
        })
        res.status(502).json({
          error: 'Failed to fetch authorization server metadata'
        })
      }
    })
  )

  /**
   * OAuth2 callback - landing page after authorization server authentication
   */
  router.get(
    '/oauth/callback',
    asyncHandler(async (req, res) => {
      const { error, error_description } = req.query

      if (error) {
        logger.error('OAuth2 callback error', {
          service: mcpName,
          error,
          error_description
        })
        // Escape user-controlled input to prevent XSS attacks
        const safeMessage = escapeHtml(error_description || error)
        return res.status(400).send(`
        <html><body>
          <h1>Authentication Failed</h1>
          <p>${safeMessage}</p>
        </body></html>
      `)
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

  /**
   * OAuth2 Authorization Endpoint - Redirect to Identity server
   */
  router.get('/oauth/authorize', (req, res) => {
    const targetUrl = new URL(`${oauth.identityUrl}/oauth/authorize`)

    // Forward all query parameters to the Identity server
    Object.entries(req.query).forEach(([key, value]) => {
      targetUrl.searchParams.set(key, value)
    })

    logger.info('Redirecting OAuth authorize to Identity server', {
      service: mcpName,
      clientId: req.query.client_id
    })

    res.redirect(targetUrl.toString())
  })

  /**
   * OAuth2 Token Endpoint - Proxy to Identity server
   */
  router.post(
    '/oauth/token',
    asyncHandler(async (req, res) => {
      try {
        const response = await axios.post(`${oauth.identityUrl}/oauth/token`, req.body, {
          headers: {
            'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
            ...(req.headers.authorization && {
              Authorization: req.headers.authorization
            })
          },
          transformRequest: [
            (data) => {
              if (typeof data === 'object' && !Buffer.isBuffer(data)) {
                return new URLSearchParams(data).toString()
              }
              return data
            }
          ]
        })

        logger.info('OAuth token request proxied successfully', {
          service: mcpName,
          grantType: req.body?.grant_type
        })

        res.json(response.data)
      } catch (err) {
        const status = err.response?.status || 500
        const data = err.response?.data || { error: 'server_error' }

        logger.error('OAuth token request failed', {
          service: mcpName,
          error: err.message,
          status
        })

        res.status(status).json(data)
      }
    })
  )

  /**
   * OAuth2 Dynamic Client Registration (DCR) - Proxy to Identity server
   * RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol
   */
  router.post(
    '/oauth/register',
    asyncHandler(async (req, res) => {
      try {
        const response = await axios.post(`${oauth.identityUrl}/oauth/register`, req.body, {
          headers: {
            'Content-Type': 'application/json',
            ...(req.headers.authorization && {
              Authorization: req.headers.authorization
            })
          }
        })

        logger.info('OAuth client registration proxied successfully', {
          service: mcpName,
          clientName: req.body?.client_name
        })

        res.status(response.status).json(response.data)
      } catch (err) {
        const status = err.response?.status || 500
        const data = err.response?.data || { error: 'server_error' }

        logger.error('OAuth client registration failed', {
          service: mcpName,
          error: err.message,
          status
        })

        res.status(status).json(data)
      }
    })
  )

  /**
   * Machine-to-Machine token endpoint - Client Credentials grant
   */
  router.post(
    '/mcp/m2m/token',
    asyncHandler(async (req, res) => {
      try {
        const tokenResponse = await oauth.getClientCredentialsToken()

        logger.info('M2M token issued', {
          service: mcpName,
          expiresIn: tokenResponse.expires_in
        })

        res.json(tokenResponse)
      } catch (err) {
        logger.error('M2M token request failed', {
          service: mcpName,
          error: err.message
        })

        // Handle common OAuth2 errors
        if (err.code === 'invalid_client') {
          return res.status(401).json({
            error: 'invalid_client',
            error_description: 'Client authentication failed. Check OAuth2 credentials.'
          })
        }

        if (err.code === 'unauthorized_client') {
          return res.status(403).json({
            error: 'unauthorized_client',
            error_description:
              'Client is not authorized for Client Credentials grant. Enable this grant type in Identity server.'
          })
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
