import http from 'node:http'
import { URL } from 'node:url'

import open from 'open'
import * as client from 'openid-client'

import { captureException, ErrorCategory } from '#src/services/error-tracking.js'
import * as logger from '#src/services/logger.js'

import * as tokenStore from './token-store.js'

interface IntrospectionCacheEntry {
  result: client.IntrospectionResponse
  timestamp: number
}

/**
 * CIMD (Client ID Metadata Document) configuration.
 *
 * Sibling of DCR: both are OAuth client-registration mechanisms. DCR registers
 * the client dynamically via POST /oauth/register; CIMD publishes a JSON
 * metadata document the authorization server fetches on demand. Because this is
 * a manifestation of the OAuth client's identity, it lives on OAuthService
 * alongside clientId / redirectUri / scopes — not on the HTTP server.
 *
 * Consumed by the /oauth/client-metadata.json endpoint in oauth-router.
 *
 * Note: `redirectUris` (plural, list) and `scope` (advertised) are intentionally
 * distinct from OAuthService's `redirectUri` (the single callback the client
 * actually uses) and `scopes` (what the client requests at auth time). They
 * describe the full surface advertised to the AS, which can be broader than
 * what any single flow uses.
 *
 * Note: this is a "server-hosted CIMD" pattern — the MCP server publishes a
 * single static document identifying itself as the OAuth client to the upstream
 * AS. The spec's CIMD model instead has the MCP client host its own document,
 * so a spec-conformant flow would show the MCP client's name on the consent
 * screen. With server-hosted CIMD the consent screen displays `clientName` for
 * every downstream MCP client. See README §"Client Registration Strategies".
 */
export interface ClientMetadataConfig {
  redirectUris: string[]
  clientName?: string
  scope?: string
  cacheMaxAge?: number // Cache-Control max-age in seconds (default: 3600)
}

interface OAuthServiceOptions {
  authServerUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string
  resourceUri?: string
  isProduction?: boolean
  clientMetadata?: ClientMetadataConfig
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
}

/**
 * Validate a resource URI per RFC 8707 Section 2:
 * - MUST be an absolute URI (RFC 3986 Section 4.3)
 * - MUST NOT include a fragment component
 * - SHOULD NOT include a query component
 */
function validateResourceUri(uri: string): void {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error(`RFC 8707: resourceUri must be an absolute URI. Got: ${uri}`)
  }

  if (parsed.hash) {
    throw new Error(`RFC 8707: resourceUri MUST NOT include a fragment component. Got: ${uri}`)
  }

  if (parsed.search) {
    throw new Error(`RFC 8707: resourceUri SHOULD NOT include a query component. Got: ${uri}`)
  }
}

/**
 * Thrown when token audience does not match the configured resource URI (RFC 8707).
 *
 * This indicates a token issued for a different resource server is being presented
 * to this MCP server — either a misconfiguration or a token misuse attempt.
 */
export class AudienceMismatchError extends Error {
  readonly expectedAudience: string
  readonly actualAudience: string | undefined

  constructor(expected: string, actual: string | undefined) {
    const detail = actual
      ? `expected "${expected}", got "${actual}"`
      : `expected "${expected}", but token has no aud claim`
    super(`RFC 8707 audience mismatch: ${detail}`)
    this.name = 'AudienceMismatchError'
    this.expectedAudience = expected
    this.actualAudience = actual
  }
}

/**
 * OAuth2 Service - Handles OAuth2/OpenID Connect flows for an MCP server
 *
 * Each MCP server should create its own instance with its specific
 * OAuth2 client credentials.
 *
 * Implements:
 * - OAuth 2.1 (draft-ietf-oauth-v2-1-13)
 * - RFC7636: Proof Key for Code Exchange (PKCE)
 * - RFC8707: Resource Indicators for OAuth 2.0
 * - RFC9728: OAuth 2.0 Protected Resource Metadata
 */
export class OAuthService {
  authServerUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string
  resourceUri: string | null
  readonly clientMetadata: ClientMetadataConfig | null
  config: client.Configuration | null

  private _isInsecure: boolean
  private _introspectionCache: Map<string, IntrospectionCacheEntry>
  private _introspectionCacheTTL: number
  private _introspectionCacheMaxSize: number

  constructor(options: OAuthServiceOptions) {
    this.authServerUrl = options.authServerUrl
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.redirectUri = options.redirectUri
    this.scopes = options.scopes || 'read write'
    // RFC8707: Resource Indicators - canonical URI of the MCP server
    // Used to bind tokens to this specific resource server
    this.resourceUri = options.resourceUri || null
    if (this.resourceUri) {
      validateResourceUri(this.resourceUri)
    }
    this.clientMetadata = options.clientMetadata ?? null
    this.config = null

    // Security: HTTP is only allowed for local development
    // In production, HTTPS is required for the authorization server
    // to prevent token interception via MITM attacks
    const isHttpUrl = this.authServerUrl.startsWith('http://')
    const isProduction = options.isProduction ?? false

    if (isHttpUrl && isProduction) {
      throw new Error(
        `Security Error: HTTPS is required for authorization server in production. ` +
          `Got: ${this.authServerUrl}. Set AUTH_SERVER_URL to an https:// URL.`
      )
    }

    this._isInsecure = isHttpUrl

    // Token introspection cache
    // Key: token (hashed), Value: { result, timestamp }
    this._introspectionCache = new Map()
    this._introspectionCacheTTL = 60 * 1000 // 60 seconds
    this._introspectionCacheMaxSize = 100
  }

  /**
   * Set resourceUri to `uri` only when the constructor caller didn't supply
   * one. Idempotent. Used by HttpServer to inject the canonical
   * `${baseUrl}/mcp` after construction so a single value flows into:
   *   - the RFC 8707 `resource` param the OAuth proxy injects on
   *     `/oauth/authorize` and `/oauth/token`,
   *   - the RFC 9728 PRM `resource` field,
   *   - the audience check in `introspectToken` (which silently no-ops when
   *     `this.resourceUri` is null — the bug this method exists to prevent).
   */
  applyDefaultResourceUri(uri: string): void {
    if (this.resourceUri) return
    validateResourceUri(uri)
    this.resourceUri = uri
  }

  /**
   * Get execute options for openid-client functions
   * Allows HTTP requests when identity URL is not HTTPS (local development)
   */
  private _getExecuteOptions(): (typeof client.allowInsecureRequests)[] | undefined {
    return this._isInsecure ? [client.allowInsecureRequests] : undefined
  }

  /**
   * Get or create the OpenID Connect client configuration
   * Uses discovery to automatically fetch server metadata
   */
  async getConfig(): Promise<client.Configuration> {
    if (this.config) {
      return this.config
    }

    logger.info('Discovering OpenID Connect configuration', {
      service: 'oauth2',
      issuer: this.authServerUrl,
      allowInsecure: this._isInsecure
    })

    try {
      this.config = await client.discovery(
        new URL(this.authServerUrl),
        this.clientId,
        this.clientSecret,
        undefined, // Use default client authentication method
        { execute: this._getExecuteOptions() }
      )

      logger.info('OpenID Connect configuration discovered', {
        service: 'oauth2',
        issuer: this.authServerUrl
      })

      return this.config
    } catch (err) {
      logger.error('Failed to discover OpenID Connect configuration', {
        service: 'oauth2',
        error: (err as Error).message
      })
      throw err
    }
  }

  /**
   * Build authorization URL for OAuth2 flow with PKCE
   *
   * Includes RFC8707 Resource Indicators when resourceUri is configured.
   * The resource parameter binds the authorization request to a specific
   * resource server, enabling audience-restricted tokens.
   */
  buildAuthorizationUrl(config: client.Configuration, codeChallenge: string, state: string): URL {
    const parameters: Record<string, string> = {
      redirect_uri: this.redirectUri,
      scope: this.scopes,
      // RFC7636: PKCE parameters
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state
    }

    // RFC8707: Resource Indicators for OAuth 2.0
    // Include resource parameter to bind token to this MCP server
    if (this.resourceUri) {
      parameters.resource = this.resourceUri
    }

    return client.buildAuthorizationUrl(config, parameters)
  }

  /**
   * Start OAuth2 authorization flow for stdio transport (local development)
   * Opens browser and waits for callback on a temporary local server
   * Uses PKCE for enhanced security
   */
  async startLocalAuthFlow(mcpSessionId: string): Promise<Record<string, unknown>> {
    const config = await this.getConfig()

    return new Promise((resolve, reject) => {
      // Generate PKCE code verifier and challenge
      const codeVerifier = client.randomPKCECodeVerifier()
      const state = client.randomState()

      const callbackUrl = new URL(this.redirectUri)
      const port = parseInt(callbackUrl.port || '3456', 10)

      // Create temporary server to receive callback
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost:${port}`)

        if (url.pathname === callbackUrl.pathname) {
          const error = url.searchParams.get('error')

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`)
            server.close()
            reject(new Error(`OAuth2 error: ${error}`))
            return
          }

          try {
            // Exchange code for tokens using PKCE
            // RFC8707: Include resource parameter in token request to bind token to this MCP server
            const grantOptions: Record<string, unknown> = {
              pkceCodeVerifier: codeVerifier,
              expectedState: state
            }

            // RFC8707: Resource Indicators - include in token request
            if (this.resourceUri) {
              grantOptions.additionalParameters = {
                resource: this.resourceUri
              }
            }

            const tokens = await client.authorizationCodeGrant(config, url, grantOptions)

            logger.info('Tokens received', {
              service: 'oauth2',
              expiresIn: tokens.expires_in,
              scope: tokens.scope
            })

            // Get user info
            const userInfo = await client.fetchUserInfo(
              config,
              tokens.access_token,
              client.skipSubjectCheck
            )

            // Store tokens
            await tokenStore.storeTokens({
              userId: (userInfo.sub || (userInfo as Record<string, unknown>).id) as string,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token!,
              expiresIn: tokens.expires_in!,
              scope: tokens.scope as string,
              mcpSessionId
            })

            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`
              <html>
                <body>
                  <h1>Authentication Successful</h1>
                  <p>Welcome, ${userInfo.email || userInfo.name}!</p>
                  <p>You can close this window and return to your terminal.</p>
                </body>
              </html>
            `)

            server.close()
            resolve(userInfo as Record<string, unknown>)
          } catch (err) {
            logger.error('Token exchange failed', {
              service: 'oauth2',
              error: (err as Error).message
            })
            res.writeHead(500, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h1>Authentication Failed</h1><p>Token exchange error</p></body></html>'
            )
            server.close()
            reject(err)
          }
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      })

      server.listen(port, async () => {
        try {
          const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
          const authUrl = this.buildAuthorizationUrl(config, codeChallenge, state)

          logger.info('Starting OAuth2 flow with PKCE', { service: 'oauth2', port })
          logger.info(`Opening browser: ${authUrl.toString()}`, { service: 'oauth2' })

          // Open browser for authentication
          open(authUrl.toString()).catch((err: Error) => {
            logger.warn('Could not open browser automatically', {
              service: 'oauth2',
              error: err.message
            })
            console.log(`\nPlease open this URL in your browser:\n${authUrl.toString()}\n`)
          })
        } catch (err) {
          server.close()
          reject(err)
        }
      })

      // Timeout after 5 minutes
      setTimeout(
        () => {
          server.close()
          reject(new Error('Authentication timeout - no callback received'))
        },
        5 * 60 * 1000
      )
    })
  }

  /**
   * Get authorization URL for remote/SSE flow
   * Returns URL and PKCE verifier that must be stored in session
   */
  async getAuthorizationUrlForRemote(): Promise<{
    authUrl: URL
    codeVerifier: string
    state: string
  }> {
    const config = await this.getConfig()
    const codeVerifier = client.randomPKCECodeVerifier()
    const state = client.randomState()
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
    const authUrl = this.buildAuthorizationUrl(config, codeChallenge, state)

    return { authUrl, codeVerifier, state }
  }

  /**
   * Handle OAuth2 callback for remote/SSE flow
   *
   * Exchanges authorization code for tokens with PKCE verification.
   * Includes RFC8707 resource parameter when configured.
   */
  async handleRemoteCallback(
    callbackUrl: URL,
    codeVerifier: string,
    expectedState: string,
    mcpSessionId: string
  ): Promise<Record<string, unknown>> {
    const config = await this.getConfig()

    // Build grant options with PKCE
    const grantOptions: Record<string, unknown> = {
      pkceCodeVerifier: codeVerifier,
      expectedState
    }

    // RFC8707: Resource Indicators - include in token request
    if (this.resourceUri) {
      grantOptions.additionalParameters = {
        resource: this.resourceUri
      }
    }

    // Exchange code for tokens using PKCE
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, grantOptions)

    logger.info('Tokens received', {
      service: 'oauth2',
      expiresIn: tokens.expires_in,
      scope: tokens.scope
    })

    // Get user info
    const userInfo = await client.fetchUserInfo(
      config,
      tokens.access_token,
      client.skipSubjectCheck
    )

    // Store tokens
    await tokenStore.storeTokens({
      userId: (userInfo.sub || (userInfo as Record<string, unknown>).id) as string,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token!,
      expiresIn: tokens.expires_in!,
      scope: tokens.scope as string,
      mcpSessionId
    })

    return userInfo as Record<string, unknown>
  }

  /** Refresh access token using refresh token */
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    logger.info('Refreshing access token', { service: 'oauth2' })

    const config = await this.getConfig()

    // RFC8707: Include resource parameter to audience-restrict the refreshed token
    const parameters: Record<string, string> = {}
    if (this.resourceUri) {
      parameters.resource = this.resourceUri
    }

    const tokens = await client.refreshTokenGrant(
      config,
      refreshToken,
      Object.keys(parameters).length > 0 ? parameters : undefined
    )

    logger.info('Access token refreshed', {
      service: 'oauth2',
      expiresIn: tokens.expires_in
    })

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in!,
      scope: tokens.scope as string | undefined
    }
  }

  /** Get user info from authorization server */
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    const config = await this.getConfig()
    return client.fetchUserInfo(config, accessToken, client.skipSubjectCheck) as Promise<
      Record<string, unknown>
    >
  }

  /**
   * Get access token using Client Credentials grant (machine-to-machine)
   *
   * This flow is designed for non-interactive authentication, typically used by:
   * - n8n workflows with LLM agents
   * - Automated systems and services
   * - Backend integrations
   *
   * Unlike Authorization Code flow, this does not require user interaction.
   * The client authenticates directly using its client_id and client_secret.
   */
  async getClientCredentialsToken(): Promise<TokenResponse> {
    logger.info('Requesting Client Credentials token', { service: 'oauth2' })

    const config = await this.getConfig()

    // RFC8707: Include resource parameter to audience-restrict the token
    const parameters: Record<string, string> = { scope: this.scopes }
    if (this.resourceUri) {
      parameters.resource = this.resourceUri
    }

    const tokenSet = await client.clientCredentialsGrant(config, parameters)

    logger.info('Client Credentials token received', {
      service: 'oauth2',
      expiresIn: tokenSet.expires_in,
      scope: tokenSet.scope
    })

    return {
      access_token: tokenSet.access_token,
      expires_in: tokenSet.expires_in!,
      token_type:
        ((tokenSet as unknown as Record<string, unknown>).token_type as string) || 'Bearer',
      scope: tokenSet.scope as string | undefined
    }
  }

  /** Revoke a token */
  async revokeToken(token: string): Promise<void> {
    logger.info('Revoking token', { service: 'oauth2' })

    const config = await this.getConfig()
    await client.tokenRevocation(config, token)

    // Clear introspection cache so a revoked token is not accepted
    // during the remaining cache TTL window
    this._introspectionCache.delete(token)

    logger.info('Token revoked', { service: 'oauth2' })
  }

  /**
   * Introspect a token to check if it's valid
   * RFC7662: OAuth 2.0 Token Introspection
   *
   * Note: The OAuth client must be confidential to introspect tokens.
   * Public clients cannot use introspection per RFC 7662.
   *
   * Performance: Results are cached for 60 seconds to avoid repeated HTTP calls.
   * Most MCP clients send multiple requests per second with the same token.
   */
  async introspectToken(token: string): Promise<client.IntrospectionResponse> {
    // Check cache first
    const cached = this._introspectionCache.get(token)
    if (cached && Date.now() - cached.timestamp < this._introspectionCacheTTL) {
      logger.debug('Token introspection cache hit', {
        service: 'oauth2',
        age: Date.now() - cached.timestamp,
        cacheSize: this._introspectionCache.size
      })
      return cached.result
    }

    const config = await this.getConfig()

    try {
      const result = await client.tokenIntrospection(config, token)

      logger.debug('Token introspection result', {
        service: 'oauth2',
        active: result.active
      })

      // RFC 8707: Validate audience if resourceUri is configured
      if (result.active && this.resourceUri) {
        const aud = (result as Record<string, unknown>).aud as string | string[] | undefined
        const audList = Array.isArray(aud) ? aud : aud ? [aud] : []

        if (!audList.includes(this.resourceUri)) {
          const actualAud = Array.isArray(aud) ? aud.join(', ') : aud
          const error = new AudienceMismatchError(this.resourceUri, actualAud)

          logger.error(error.message, {
            service: 'oauth2',
            expectedAudience: this.resourceUri,
            actualAudience: aud ?? 'absent',
            sub: (result as Record<string, unknown>).sub
          })

          captureException(error, {
            tags: { 'error.category': ErrorCategory.AUTH },
            extra: {
              expectedAudience: this.resourceUri,
              actualAudience: aud ?? 'absent',
              tokenSub: (result as Record<string, unknown>).sub
            },
            level: 'error'
          })

          // Cache as inactive so repeated requests don't re-trigger AS call + error tracking
          const inactiveResult = { active: false } as client.IntrospectionResponse
          this._cacheIntrospection(token, inactiveResult)
          return inactiveResult
        }
      }

      // Cache the result
      this._cacheIntrospection(token, result)

      return result
    } catch (err) {
      logger.error('Token introspection failed', {
        service: 'oauth2',
        error: (err as Error).message
      })
      // If introspection fails, treat as inactive
      return { active: false } as client.IntrospectionResponse
    }
  }

  /** Cache token introspection result */
  private _cacheIntrospection(token: string, result: client.IntrospectionResponse): void {
    // Evict oldest entry if cache is full
    if (this._introspectionCache.size >= this._introspectionCacheMaxSize) {
      const oldestKey = this._introspectionCache.keys().next().value!
      this._introspectionCache.delete(oldestKey)
    }

    this._introspectionCache.set(token, {
      result,
      timestamp: Date.now()
    })
  }

  /** Clear introspection cache (useful for testing) */
  clearIntrospectionCache(): void {
    this._introspectionCache.clear()
  }

  /** Get valid access token for a session, refreshing if needed */
  async getValidAccessToken(mcpSessionId: string): Promise<string | null> {
    const tokens = await tokenStore.getTokensBySession(mcpSessionId)

    if (!tokens) {
      logger.debug('No tokens found for session', { service: 'oauth2', mcpSessionId })
      return null
    }

    // Check if token is expired or about to expire (5 min buffer)
    const expiresAt = new Date(tokens.expiresAt)
    const bufferMs = 5 * 60 * 1000
    const needsRefresh = expiresAt.getTime() - Date.now() < bufferMs

    if (!needsRefresh) {
      return tokens.accessToken
    }

    // Try to refresh
    if (!tokens.refreshToken) {
      logger.warn('Token expired and no refresh token available', {
        service: 'oauth2',
        mcpSessionId
      })
      return null
    }

    try {
      const newTokens = await this.refreshAccessToken(tokens.refreshToken)

      // Store new tokens
      await tokenStore.storeTokens({
        userId: tokens.userId,
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || tokens.refreshToken,
        expiresIn: newTokens.expires_in,
        scope: newTokens.scope!,
        mcpSessionId
      })

      return newTokens.access_token
    } catch (err) {
      logger.error('Failed to refresh token', {
        service: 'oauth2',
        error: (err as Error).message,
        mcpSessionId
      })
      return null
    }
  }
}

export default OAuthService
