/* global fetch, URLSearchParams */

/**
 * OAuth2 Reference Service Adapter
 *
 * Adapter that makes the OAuth2 reference implementation (from-scratch)
 * compatible with the MCP OAuth interface used by lib/mcp servers.
 *
 * This adapter bridges the gap between:
 * - The from-scratch OAuth2 implementation (core/)
 * - The interface expected by StdioServer and HttpServer
 *
 * Interface contract (required by MCP servers):
 * - identityUrl: string
 * - getValidAccessToken(sessionId): Promise<string|null>
 * - startLocalAuthFlow(sessionId): Promise<UserInfo>
 * - getAuthorizationUrlForRemote(): Promise<{ authUrl, codeVerifier, state }>
 * - handleRemoteCallback(callbackUrl, codeVerifier, state, sessionId): Promise<UserInfo>
 */

import { OAuth2Orchestrator } from '../core/oauth2-orchestrator.js'
import { OAuth2LocalFlowHandler } from './local-flow-handler.js'
import { OAuth2UserInfoService } from './user-info-service.js'

export class OAuth2ReferenceService {
  /**
   * Create a new OAuth2 Reference Service
   *
   * @param {Object} options - OAuth2 client configuration
   * @param {string} options.identityUrl - OAuth2/OIDC issuer URL
   * @param {string} options.clientId - OAuth2 client ID
   * @param {string} options.clientSecret - OAuth2 client secret
   * @param {string} options.redirectUri - OAuth2 redirect URI
   * @param {string} [options.scopes='read write'] - OAuth2 scopes
   * @param {string} [options.resourceUri] - RFC8707 Resource URI (MCP server canonical URI)
   * @param {Object} [options.db] - Database configuration for token storage (optional, uses global pg-client)
   */
  constructor(options) {
    this.identityUrl = options.identityUrl
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.redirectUri = options.redirectUri
    this.scopes = options.scopes || 'read write'
    this.resourceUri = options.resourceUri || null

    // Extract port from redirect URI for local flow
    const port = this._extractPort(options.redirectUri)

    // Initialize core orchestrator
    this.orchestrator = new OAuth2Orchestrator({
      oauth2: {
        authServerUrl: options.identityUrl,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        scopes: this.scopes,
        debug: process.env.OAUTH2_DEBUG === 'true'
      },
      db: options.db || {}, // Database config (not used directly, pg-client is global)
      port
    })

    // Initialize adapters for missing functionality
    this.localFlowHandler = new OAuth2LocalFlowHandler({
      orchestrator: this.orchestrator,
      redirectUri: options.redirectUri,
      resourceUri: this.resourceUri
    })

    this.userInfoService = new OAuth2UserInfoService({
      orchestrator: this.orchestrator
    })

    // Track initialization state
    this.initialized = false
  }

  /**
   * Initialize OAuth2 service
   *
   * Performs discovery and client registration.
   * Called automatically by other methods if not already initialized.
   *
   * @private
   */
  async _ensureInitialized() {
    if (this.initialized) {
      return
    }

    // Connect to MySQL
    await this.orchestrator.connect()

    // Discover OAuth2 endpoints
    await this.orchestrator.discoverOAuth2Endpoints()

    // Obtain client credentials (dynamic registration or pre-configured)
    await this.orchestrator.obtainClientCredentials()

    this.initialized = true
  }

  /**
   * Get valid access token for a session
   *
   * Required by MCP interface. Checks if a valid token exists for the session.
   * Returns null if no token or token is expired.
   *
   * @param {string} sessionId - MCP session identifier
   * @returns {Promise<string|null>} Valid access token or null
   */
  async getValidAccessToken(sessionId) {
    try {
      await this._ensureInitialized()

      const accessToken = await this.orchestrator.getValidAccessToken(sessionId)

      if (accessToken) {
        this.orchestrator.logger.debug(
          'TOKEN_RETRIEVAL',
          `Retrieved valid access token for session: ${sessionId}`
        )
      }

      return accessToken
    } catch (error) {
      this.orchestrator.logger.error('ERROR_TOKEN', 'Failed to get valid access token', {
        sessionId,
        error: error.message
      })
      return null
    }
  }

  /**
   * Start local authentication flow for stdio transport
   *
   * Required by MCP interface. This is the main entry point for local auth.
   * Opens browser and waits for OAuth callback.
   *
   * @param {string} sessionId - MCP session identifier
   * @returns {Promise<Object>} User info after successful authentication
   */
  async startLocalAuthFlow(sessionId) {
    await this._ensureInitialized()

    this.orchestrator.logger.info('INITIALIZATION', 'Starting local OAuth flow (stdio transport)', {
      sessionId
    })

    // Start local flow (opens browser, waits for callback)
    const tokenResponse = await this.localFlowHandler.startLocalFlow(sessionId)

    // Fetch user info
    const userInfo = await this.userInfoService.getUserInfo(tokenResponse.accessToken)

    this.orchestrator.logger.info(
      'USER_INFO_SUCCESS',
      'Local authentication completed successfully',
      { sessionId, email: userInfo.email }
    )

    return userInfo
  }

  /**
   * Get authorization URL for remote flow
   *
   * Used by remote/SSE transport. Returns URL and PKCE verifier that must be
   * stored in session for callback handling.
   *
   * @returns {Promise<{ authUrl: URL, codeVerifier: string, state: string }>}
   */
  async getAuthorizationUrlForRemote() {
    await this._ensureInitialized()

    // Generate session ID for this authorization request
    const sessionId = `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Start authorization flow
    const authRequest = this.orchestrator.startAuthorizationFlow(sessionId)

    return {
      authUrl: new URL(authRequest.authorizationUrl),
      codeVerifier: authRequest.codeVerifier,
      state: authRequest.state,
      sessionId // Return for tracking
    }
  }

  /**
   * Handle OAuth2 callback for remote flow
   *
   * Exchanges authorization code for tokens with PKCE verification.
   *
   * @param {URL} callbackUrl - The callback URL with code and state
   * @param {string} codeVerifier - PKCE code verifier from session
   * @param {string} expectedState - Expected state from session
   * @param {string} sessionId - MCP session identifier
   * @returns {Promise<Object>} User info after successful authentication
   */
  async handleRemoteCallback(callbackUrl, codeVerifier, expectedState, _sessionId) {
    await this._ensureInitialized()

    const code = callbackUrl.searchParams.get('code')
    const state = callbackUrl.searchParams.get('state')

    // Validate state
    if (state !== expectedState) {
      throw new Error('State mismatch - possible CSRF attack')
    }

    if (!code) {
      throw new Error('Missing authorization code in callback')
    }

    // Exchange code for token
    const result = await this.orchestrator.exchangeCodeForToken(code, state)

    // Fetch user info
    const userInfo = await this.userInfoService.getUserInfo(result.accessToken)

    return userInfo
  }

  /**
   * Get user info from access token
   *
   * @param {string} accessToken - Access token
   * @returns {Promise<Object>} User info
   */
  async getUserInfo(accessToken) {
    await this._ensureInitialized()
    return this.userInfoService.getUserInfo(accessToken)
  }

  /**
   * Refresh access token using refresh token
   *
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} New token response
   */
  async refreshAccessToken(refreshToken) {
    await this._ensureInitialized()

    const tokenResponse = await this.orchestrator.authFlowService.refreshAccessToken({
      tokenEndpoint: this.orchestrator.oauth2Metadata.tokenEndpoint,
      refreshToken,
      clientId: this.orchestrator.clientCredentials.clientId,
      clientSecret: this.orchestrator.clientCredentials.clientSecret
    })

    return {
      access_token: tokenResponse.accessToken,
      refresh_token: tokenResponse.refreshToken,
      expires_in: tokenResponse.expiresIn,
      scope: tokenResponse.scope
    }
  }

  /**
   * Revoke a token
   *
   * Note: Not all authorization servers support revocation.
   *
   * @param {string} token - Token to revoke
   */
  async revokeToken(token) {
    await this._ensureInitialized()

    const metadata = this.orchestrator.oauth2Metadata?.authServerMetadata

    if (!metadata?.revocation_endpoint) {
      this.orchestrator.logger.warn(
        'TOKEN_REVOCATION',
        'Authorization server does not support token revocation'
      )
      return
    }

    this.orchestrator.logger.info('TOKEN_REVOCATION', 'Revoking token', {
      endpoint: metadata.revocation_endpoint
    })

    const credentials = this.orchestrator.clientCredentials

    const response = await fetch(metadata.revocation_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...(credentials.clientSecret && {
          Authorization: `Basic ${Buffer.from(
            `${credentials.clientId}:${credentials.clientSecret}`
          ).toString('base64')}`
        })
      },
      body: new URLSearchParams({
        token,
        client_id: credentials.clientId
      }).toString()
    })

    if (!response.ok) {
      throw new Error(`Token revocation failed: ${response.status}`)
    }

    this.orchestrator.logger.info('TOKEN_REVOCATION', 'Token revoked successfully')
  }

  /**
   * Extract port from redirect URI
   * @private
   */
  _extractPort(redirectUri) {
    try {
      const url = new URL(redirectUri)
      return parseInt(url.port || '3456', 10)
    } catch (_err) {
      return 3456
    }
  }

  /**
   * Disconnect from MySQL
   */
  async disconnect() {
    await this.orchestrator.disconnect()
  }
}
