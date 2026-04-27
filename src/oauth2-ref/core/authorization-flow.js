/* global fetch, URLSearchParams */

/**
 * OAuth2 Authorization Flow Module
 *
 * Implements OAuth2 Authorization Code Flow with PKCE according to:
 * - OAuth 2.1 (draft-ietf-oauth-v2-1-13)
 * - RFC7636: Proof Key for Code Exchange (PKCE)
 * - RFC8707: Resource Indicators for OAuth 2.0
 *
 * This module handles the authorization phase of the OAuth2 flow:
 * 1. Generate PKCE code verifier and challenge
 * 2. Build authorization request URL
 * 3. Handle authorization callback
 * 4. Exchange authorization code for access token
 */

import crypto from 'node:crypto'
import { OAuth2Logger } from './logger.js'

/**
 * OAuth2 Authorization Flow Service
 * Handles the authorization code grant flow with PKCE
 */
export class OAuth2AuthorizationFlowService {
  constructor(logger = null) {
    this.logger = logger || new OAuth2Logger()
    // Store pending authorization requests
    this.pendingAuthorizations = new Map()
  }

  /**
   * PKCE STEP 1: Generate Code Verifier
   *
   * According to RFC7636, the code verifier is a cryptographically random string
   * using the characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
   * with a minimum length of 43 characters and maximum of 128 characters.
   *
   * @returns {string} URL-safe random string (code verifier)
   */
  generateCodeVerifier() {
    // Generate 32 random bytes and encode as base64url (results in 43 chars)
    const randomBytes = crypto.randomBytes(32)
    const codeVerifier = randomBytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    return codeVerifier
  }

  /**
   * PKCE STEP 2: Generate Code Challenge
   *
   * According to RFC7636, the code challenge is derived from the code verifier:
   * - code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
   * - code_challenge_method = "S256"
   *
   * @param {string} codeVerifier - The code verifier
   * @returns {string} Base64URL-encoded SHA256 hash of the verifier
   */
  generateCodeChallenge(codeVerifier) {
    const hash = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    return hash
  }

  /**
   * Generate State Parameter
   *
   * According to OAuth 2.1, the state parameter is used to prevent CSRF attacks.
   * It should be an unguessable random string.
   *
   * @returns {string} Random state value
   */
  generateState() {
    return crypto.randomBytes(16).toString('hex')
  }

  /**
   * BUILD AUTHORIZATION REQUEST: Construct authorization URL
   *
   * According to OAuth 2.1 Section 3.1, the authorization request includes:
   * - response_type: "code" for authorization code flow
   * - client_id: The client identifier
   * - redirect_uri: Where to redirect after authorization
   * - scope: Requested scope (optional)
   * - state: CSRF protection token
   * - code_challenge: PKCE challenge
   * - code_challenge_method: "S256" for SHA-256
   * - resource: Target resource (RFC8707)
   *
   * @param {Object} params - Authorization request parameters
   * @param {string} params.authorizationEndpoint - Authorization server's authorization endpoint
   * @param {string} params.clientId - Client identifier
   * @param {string} params.redirectUri - Callback URI
   * @param {string} params.resourceUri - Target MCP server URI (RFC8707)
   * @param {string} params.scope - Requested scope (optional)
   * @param {string} params.sessionId - Session identifier for tracking
   * @returns {Object} Authorization URL and state information
   */
  buildAuthorizationRequest(params) {
    const {
      authorizationEndpoint,
      clientId,
      redirectUri,
      resourceUri,
      scope = '',
      sessionId
    } = params

    this.logger.logAuthCodeFlowStart()

    // Generate PKCE parameters
    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = this.generateCodeChallenge(codeVerifier)
    const state = this.generateState()

    this.logger.logPKCEGeneration(codeChallenge)

    // Build authorization URL
    const authUrl = new URL(authorizationEndpoint)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    // Add resource parameter per RFC8707
    if (resourceUri) {
      authUrl.searchParams.set('resource', resourceUri)
    }

    // Add scope if provided
    if (scope) {
      authUrl.searchParams.set('scope', scope)
    }

    // Store authorization state for callback validation
    this.pendingAuthorizations.set(state, {
      sessionId,
      codeVerifier,
      redirectUri,
      timestamp: Date.now()
    })

    this.logger.logAuthorizationRequest(authUrl.toString())

    return {
      authorizationUrl: authUrl.toString(),
      state,
      codeVerifier // Return for storage if needed
    }
  }

  /**
   * HANDLE CALLBACK: Process authorization callback
   *
   * After user authorization, the authorization server redirects to the
   * redirect_uri with either:
   * - Success: code and state parameters
   * - Error: error, error_description, and state parameters
   *
   * This method validates the callback and extracts the authorization code.
   *
   * @param {Object} callbackParams - Query parameters from callback
   * @param {string} callbackParams.code - Authorization code (on success)
   * @param {string} callbackParams.state - State parameter
   * @param {string} callbackParams.error - Error code (on error)
   * @param {string} callbackParams.error_description - Error description (on error)
   * @returns {Object} Validated callback data with code verifier
   */
  handleAuthorizationCallback(callbackParams) {
    const { code, state, error, error_description } = callbackParams

    this.logger.logCallbackReceived(code, state)

    // Check for error response
    if (error) {
      const errorMsg = error_description || error
      this.logger.logAuthorizationError(new Error(errorMsg))
      throw new Error(`Authorization failed: ${errorMsg}`)
    }

    // Validate state parameter
    if (!state) {
      throw new Error('Missing state parameter in callback')
    }

    const pendingAuth = this.pendingAuthorizations.get(state)
    if (!pendingAuth) {
      throw new Error('Invalid or expired state parameter')
    }

    // Clean up pending authorization
    this.pendingAuthorizations.delete(state)

    // Validate authorization code
    if (!code) {
      throw new Error('Missing authorization code in callback')
    }

    return {
      code,
      codeVerifier: pendingAuth.codeVerifier,
      redirectUri: pendingAuth.redirectUri,
      sessionId: pendingAuth.sessionId
    }
  }

  /**
   * EXCHANGE CODE FOR TOKEN: Request access token
   *
   * According to OAuth 2.1 Section 3.2, the token request includes:
   * - grant_type: "authorization_code"
   * - code: The authorization code
   * - redirect_uri: Must match the one from authorization request
   * - client_id: Client identifier
   * - client_secret: Client secret (if confidential client)
   * - code_verifier: PKCE verifier
   * - resource: Target resource (RFC8707)
   *
   * Response includes:
   * - access_token: The access token
   * - token_type: "Bearer"
   * - expires_in: Token lifetime in seconds
   * - refresh_token: Refresh token (optional)
   * - scope: Granted scope
   *
   * @param {Object} params - Token request parameters
   * @param {string} params.tokenEndpoint - Token endpoint URL
   * @param {string} params.code - Authorization code
   * @param {string} params.codeVerifier - PKCE verifier
   * @param {string} params.redirectUri - Redirect URI from authorization request
   * @param {string} params.clientId - Client identifier
   * @param {string} params.clientSecret - Client secret (optional)
   * @param {string} params.resourceUri - Target resource (RFC8707)
   * @returns {Object} Token response
   */
  async exchangeCodeForToken(params) {
    const { tokenEndpoint, code, codeVerifier, redirectUri, clientId, clientSecret, resourceUri } =
      params

    this.logger.logTokenRequest(tokenEndpoint)

    // Build token request body per OAuth 2.1
    const tokenRequest = new URLSearchParams()
    tokenRequest.set('grant_type', 'authorization_code')
    tokenRequest.set('code', code)
    tokenRequest.set('redirect_uri', redirectUri)
    tokenRequest.set('client_id', clientId)
    tokenRequest.set('code_verifier', codeVerifier)

    // Add resource parameter per RFC8707
    if (resourceUri) {
      tokenRequest.set('resource', resourceUri)
    }

    // Prepare headers
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    }

    // Add client authentication if secret is provided
    // Using client_secret_basic method (HTTP Basic Auth)
    if (clientSecret) {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers,
        body: tokenRequest.toString()
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `Token request failed: ${response.status} ${response.statusText}\n${errorBody}`
        )
      }

      const tokenResponse = await response.json()

      // Validate response
      if (!tokenResponse.access_token) {
        throw new Error('Token response missing access_token')
      }

      this.logger.logAuthCodeFlowComplete(tokenResponse)

      return {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresIn: tokenResponse.expires_in,
        refreshToken: tokenResponse.refresh_token,
        scope: tokenResponse.scope,
        rawResponse: tokenResponse
      }
    } catch (error) {
      this.logger.logTokenError(error)
      throw error
    }
  }

  /**
   * REFRESH TOKEN: Obtain new access token using refresh token
   *
   * According to OAuth 2.1 Section 4.3, refresh token requests include:
   * - grant_type: "refresh_token"
   * - refresh_token: The refresh token
   * - client_id: Client identifier
   * - client_secret: Client secret (if confidential client)
   * - scope: Requested scope (optional, must not exceed original)
   *
   * @param {Object} params - Refresh token request parameters
   * @param {string} params.tokenEndpoint - Token endpoint URL
   * @param {string} params.refreshToken - Refresh token
   * @param {string} params.clientId - Client identifier
   * @param {string} params.clientSecret - Client secret (optional)
   * @param {string} params.scope - Requested scope (optional)
   * @param {string} params.resourceUri - Target resource (RFC8707)
   * @returns {Object} New token response
   */
  async refreshAccessToken(params) {
    const { tokenEndpoint, refreshToken, clientId, clientSecret, scope, resourceUri } = params

    this.logger.info('TOKEN_REFRESH', `Refreshing access token`)

    // Build refresh request
    const refreshRequest = new URLSearchParams()
    refreshRequest.set('grant_type', 'refresh_token')
    refreshRequest.set('refresh_token', refreshToken)
    refreshRequest.set('client_id', clientId)

    if (scope) {
      refreshRequest.set('scope', scope)
    }

    // Add resource parameter per RFC8707
    if (resourceUri) {
      refreshRequest.set('resource', resourceUri)
    }

    // Prepare headers
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    }

    // Add client authentication if secret is provided
    if (clientSecret) {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers,
        body: refreshRequest.toString()
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `Token refresh failed: ${response.status} ${response.statusText}\n${errorBody}`
        )
      }

      const tokenResponse = await response.json()

      if (!tokenResponse.access_token) {
        throw new Error('Refresh response missing access_token')
      }

      return {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresIn: tokenResponse.expires_in,
        refreshToken: tokenResponse.refresh_token || refreshToken, // Reuse old if not rotated
        scope: tokenResponse.scope,
        rawResponse: tokenResponse
      }
    } catch (error) {
      this.logger.logTokenError(error)
      throw error
    }
  }

  /**
   * Clean up expired pending authorizations
   * Should be called periodically to prevent memory leaks
   *
   * @param {number} maxAge - Maximum age in milliseconds (default: 10 minutes)
   */
  cleanupExpiredAuthorizations(maxAge = 10 * 60 * 1000) {
    const now = Date.now()
    for (const [state, authData] of this.pendingAuthorizations.entries()) {
      if (now - authData.timestamp > maxAge) {
        this.pendingAuthorizations.delete(state)
        this.logger.warn('AUTH_CODE_START', `Cleaned up expired authorization request: ${state}`)
      }
    }
  }
}
