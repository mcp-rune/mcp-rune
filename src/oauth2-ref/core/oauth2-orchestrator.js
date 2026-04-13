/**
 * OAuth2 Flow Orchestrator
 *
 * Coordinates the complete OAuth2 authorization flow with all PHASE operations:
 * - PHASE 1: Discovery - Discover OAuth2 endpoints
 * - PHASE 2: Registration - Obtain client credentials
 * - PHASE 3: Authorization - Start OAuth2 authorization flow for a session
 * - PHASE 4: Token Exchange - Exchange authorization code for access token
 */

import { OAuth2Logger } from './logger.js'
import { OAuth2DiscoveryService } from './discovery.js'
import { OAuth2ClientRegistrationService } from './client-registration.js'
import { OAuth2AuthorizationFlowService } from './authorization-flow.js'
import { OAuth2TokenManager } from './token-manager.js'

export class OAuth2Orchestrator {
  constructor(config) {
    this.config = config
    this.logger = new OAuth2Logger(config.oauth2.debug)
    this.discoveryService = new OAuth2DiscoveryService(this.logger)
    this.registrationService = new OAuth2ClientRegistrationService(this.logger)
    this.authFlowService = new OAuth2AuthorizationFlowService(this.logger)
    this.tokenManager = new OAuth2TokenManager(config.db, this.logger)

    // OAuth2 metadata (discovered at runtime)
    this.oauth2Metadata = null
    this.clientCredentials = null

    // Track authorization state per session
    this.sessionAuthState = new Map()
  }

  /**
   * PHASE 1: Discovery - Discover OAuth2 endpoints
   * This happens once at server startup
   */
  async discoverOAuth2Endpoints() {
    this.logger.info('INITIALIZATION', 'Starting OAuth2 server discovery')

    try {
      // Since the MCP server IS the protected resource, we skip protected resource
      // metadata discovery and directly fetch authorization server metadata.
      // This avoids the circular dependency of the server trying to discover itself.

      this.logger.info(
        'DISCOVERY_AUTH_SERVER',
        `Fetching Authorization Server Metadata from ${this.config.oauth2.authServerUrl}`
      )

      const authServerMetadata = await this.discoveryService.fetchAuthorizationServerMetadata(
        this.config.oauth2.authServerUrl
      )

      // Build metadata object with the endpoints we need
      this.oauth2Metadata = {
        authServerMetadata,
        authorizationEndpoint: authServerMetadata.authorization_endpoint,
        tokenEndpoint: authServerMetadata.token_endpoint,
        registrationEndpoint: authServerMetadata.registration_endpoint
      }

      this.logger.info('DISCOVERY_COMPLETE', 'OAuth2 endpoints discovered', {
        authorizationEndpoint: this.oauth2Metadata.authorizationEndpoint,
        tokenEndpoint: this.oauth2Metadata.tokenEndpoint,
        registrationEndpoint: this.oauth2Metadata.registrationEndpoint
      })

      return this.oauth2Metadata
    } catch (error) {
      this.logger.logDiscoveryError(error)
      throw error
    }
  }

  /**
   * PHASE 2: Registration - Obtain client credentials
   * Tries dynamic registration first, falls back to pre-configured credentials
   */
  async obtainClientCredentials() {
    this.logger.info('INITIALIZATION', 'Obtaining OAuth2 client credentials')

    try {
      const redirectUri = `http://localhost:${this.config.port}/callback`

      this.clientCredentials = await this.registrationService.obtainClientCredentials({
        registrationEndpoint: this.oauth2Metadata.registrationEndpoint,
        redirectUris: [redirectUri],
        preConfiguredClientId: this.config.oauth2.clientId,
        preConfiguredClientSecret: this.config.oauth2.clientSecret,
        clientName: 'Movida MCP Server (OAuth2)',
        scope: '' // Empty scope as requested
      })

      this.logger.info('REGISTRATION_COMPLETE', 'Client credentials obtained', {
        clientId: this.clientCredentials.clientId,
        isPreConfigured: this.clientCredentials.isPreConfigured || false
      })

      return this.clientCredentials
    } catch (error) {
      this.logger.logRegistrationError(error)
      throw error
    }
  }

  /**
   * PHASE 3: Authorization - Start OAuth2 authorization flow for a session
   */
  startAuthorizationFlow(sessionId) {
    this.logger.logFlowStart(sessionId)

    const redirectUri = `http://localhost:${this.config.port}/callback`
    const resourceUri = `http://localhost:${this.config.port}` // Canonical MCP server URI

    const authRequest = this.authFlowService.buildAuthorizationRequest({
      authorizationEndpoint: this.oauth2Metadata.authorizationEndpoint,
      clientId: this.clientCredentials.clientId,
      redirectUri,
      resourceUri,
      scope: '', // Empty scope as requested
      sessionId
    })

    // Store authorization state for this session
    this.sessionAuthState.set(sessionId, {
      state: authRequest.state,
      codeVerifier: authRequest.codeVerifier,
      timestamp: Date.now()
    })

    this.logger.logUserAuthorization()

    return authRequest
  }

  /**
   * PHASE 4: Token Exchange - Exchange authorization code for access token
   * Returns sessionId, tokenResponse, and accessToken
   */
  async exchangeCodeForToken(code, state) {
    // Find session by state
    let sessionId = null
    for (const [sid, authState] of this.sessionAuthState.entries()) {
      if (authState.state === state) {
        sessionId = sid
        break
      }
    }

    if (!sessionId) {
      throw new Error('No session found for authorization state')
    }

    const authState = this.sessionAuthState.get(sessionId)

    const redirectUri = `http://localhost:${this.config.port}/callback`
    const resourceUri = `http://localhost:${this.config.port}`

    // Exchange code for token
    const tokenResponse = await this.authFlowService.exchangeCodeForToken({
      tokenEndpoint: this.oauth2Metadata.tokenEndpoint,
      code,
      codeVerifier: authState.codeVerifier,
      redirectUri,
      clientId: this.clientCredentials.clientId,
      clientSecret: this.clientCredentials.clientSecret,
      resourceUri
    })

    // Store token in MySQL
    await this.tokenManager.storeToken(sessionId, tokenResponse)

    // Clean up authorization state
    this.sessionAuthState.delete(sessionId)

    return {
      sessionId,
      tokenResponse,
      accessToken: tokenResponse.accessToken
    }
  }

  /**
   * Helper: Get valid access token for a session
   * Returns token or null if not found/expired
   */
  async getValidAccessToken(sessionId) {
    try {
      const token = await this.tokenManager.getValidToken(sessionId)
      return token ? token.accessToken : null
    } catch (error) {
      this.logger.logTokenError(error)
      return null
    }
  }

  /**
   * Connect to MySQL
   */
  async connect() {
    await this.tokenManager.connect()
  }

  /**
   * Disconnect from MySQL
   */
  async disconnect() {
    await this.tokenManager.disconnect()
  }
}
