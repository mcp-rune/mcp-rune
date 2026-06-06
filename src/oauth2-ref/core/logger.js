/**
 * OAuth2 Flow Logger
 *
 * Provides comprehensive logging for all OAuth2 authorization flow phases.
 * Each log entry clearly indicates which step of the OAuth2 flow is being executed.
 *
 * Uses Winston for file and console logging.
 */

import * as baseLogger from '#src/runtime/logger.js'

/**
 * OAuth2 Flow Phases - Maps to the MCP Authorization specification
 */
const OAUTH2_PHASES = {
  // Initial setup
  INITIALIZATION: 'INITIALIZATION',

  // Discovery phase (RFC9728 - Protected Resource Metadata)
  DISCOVERY_START: 'DISCOVERY_START',
  DISCOVERY_PROTECTED_RESOURCE: 'DISCOVERY_PROTECTED_RESOURCE',
  DISCOVERY_AUTH_SERVER: 'DISCOVERY_AUTH_SERVER',
  DISCOVERY_COMPLETE: 'DISCOVERY_COMPLETE',

  // Dynamic Client Registration phase (RFC7591)
  REGISTRATION_START: 'REGISTRATION_START',
  REGISTRATION_REQUEST: 'REGISTRATION_REQUEST',
  REGISTRATION_COMPLETE: 'REGISTRATION_COMPLETE',

  // Authorization Code Flow phase (OAuth 2.1 with PKCE)
  AUTH_CODE_START: 'AUTH_CODE_START',
  AUTH_CODE_PKCE_GENERATION: 'AUTH_CODE_PKCE_GENERATION',
  AUTH_CODE_AUTHORIZATION_REQUEST: 'AUTH_CODE_AUTHORIZATION_REQUEST',
  AUTH_CODE_USER_AUTHORIZATION: 'AUTH_CODE_USER_AUTHORIZATION',
  AUTH_CODE_CALLBACK_RECEIVED: 'AUTH_CODE_CALLBACK_RECEIVED',
  AUTH_CODE_TOKEN_REQUEST: 'AUTH_CODE_TOKEN_REQUEST',
  AUTH_CODE_COMPLETE: 'AUTH_CODE_COMPLETE',

  // Token management phase
  TOKEN_STORAGE: 'TOKEN_STORAGE',
  TOKEN_RETRIEVAL: 'TOKEN_RETRIEVAL',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  TOKEN_VALIDATION: 'TOKEN_VALIDATION',
  TOKEN_EXPIRATION: 'TOKEN_EXPIRATION',

  // MCP operations with OAuth2
  MCP_REQUEST_WITH_TOKEN: 'MCP_REQUEST_WITH_TOKEN',
  MCP_RESPONSE_SUCCESS: 'MCP_RESPONSE_SUCCESS',
  MCP_RESPONSE_UNAUTHORIZED: 'MCP_RESPONSE_UNAUTHORIZED',

  // Error handling
  ERROR_DISCOVERY: 'ERROR_DISCOVERY',
  ERROR_REGISTRATION: 'ERROR_REGISTRATION',
  ERROR_AUTHORIZATION: 'ERROR_AUTHORIZATION',
  ERROR_TOKEN: 'ERROR_TOKEN',
  ERROR_MCP: 'ERROR_MCP',

  // User info
  USER_INFO_FETCH: 'USER_INFO_FETCH',
  USER_INFO_SUCCESS: 'USER_INFO_SUCCESS',
  USER_INFO_ERROR: 'USER_INFO_ERROR',
  USER_INFO_NO_COMPANY: 'USER_INFO_NO_COMPANY'
}

class OAuth2Logger {
  constructor(enableDebug = false) {
    this.enableDebug = enableDebug
    this.sessionId = null
    // Base metadata for OAuth2 logs
    this.baseMetadata = { service: 'oauth2' }
  }

  /**
   * Set the current session ID for tracking
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId
  }

  /**
   * Build metadata object for logging
   */
  _buildMeta(phase, details = null) {
    const meta = {
      ...this.baseMetadata,
      phase,
      sessionId: this.sessionId
    }

    if (details) {
      if (typeof details === 'object') {
        Object.assign(meta, details)
      } else {
        meta.details = details
      }
    }

    return meta
  }

  /**
   * Log info message
   */
  info(phase, message, details = null) {
    const meta = this._buildMeta(phase, details)
    baseLogger.info(message, meta)
  }

  /**
   * Log warning message
   */
  warn(phase, message, details = null) {
    const meta = this._buildMeta(phase, details)
    baseLogger.warn(message, meta)
  }

  /**
   * Log error message
   */
  error(phase, message, details = null) {
    const meta = this._buildMeta(phase, details)
    baseLogger.error(message, meta)
  }

  /**
   * Log debug message (only if debug is enabled)
   */
  debug(phase, message, details = null) {
    if (!this.enableDebug) return

    const meta = this._buildMeta(phase, details)
    baseLogger.debug(message, meta)
  }

  /**
   * Log the start of OAuth2 flow
   */
  logFlowStart(sessionId) {
    this.setSessionId(sessionId)
    this.info(OAUTH2_PHASES.INITIALIZATION, 'OAuth2 authorization flow initiated', { sessionId })
  }

  /**
   * Log discovery phase events
   */
  logDiscoveryStart() {
    this.info(
      OAUTH2_PHASES.DISCOVERY_START,
      'Starting OAuth2 server discovery (RFC9728 - Protected Resource Metadata)'
    )
  }

  logProtectedResourceMetadata(resourceUrl, metadata) {
    this.info(
      OAUTH2_PHASES.DISCOVERY_PROTECTED_RESOURCE,
      `Retrieved Protected Resource Metadata from: ${resourceUrl}`,
      { authorizationServers: metadata.authorization_servers }
    )
  }

  logAuthServerMetadata(authServerUrl, metadata) {
    this.info(
      OAUTH2_PHASES.DISCOVERY_AUTH_SERVER,
      `Retrieved Authorization Server Metadata (RFC8414) from: ${authServerUrl}`,
      {
        issuer: metadata.issuer,
        authorizationEndpoint: metadata.authorization_endpoint,
        tokenEndpoint: metadata.token_endpoint,
        registrationEndpoint: metadata.registration_endpoint
      }
    )
  }

  logDiscoveryComplete() {
    this.info(OAUTH2_PHASES.DISCOVERY_COMPLETE, 'OAuth2 server discovery completed successfully')
  }

  /**
   * Log registration phase events
   */
  logRegistrationStart() {
    this.info(OAUTH2_PHASES.REGISTRATION_START, 'Starting Dynamic Client Registration (RFC7591)')
  }

  logRegistrationRequest(registrationUrl, requestData) {
    this.debug(
      OAUTH2_PHASES.REGISTRATION_REQUEST,
      `Sending registration request to: ${registrationUrl}`,
      { redirectUris: requestData.redirect_uris }
    )
  }

  logRegistrationComplete(clientId) {
    this.info(OAUTH2_PHASES.REGISTRATION_COMPLETE, 'Dynamic Client Registration completed', {
      clientId
    })
  }

  /**
   * Log authorization code flow events
   */
  logAuthCodeFlowStart() {
    this.info(
      OAUTH2_PHASES.AUTH_CODE_START,
      'Starting Authorization Code Flow (OAuth 2.1 with PKCE)'
    )
  }

  logPKCEGeneration(codeChallenge) {
    this.debug(OAUTH2_PHASES.AUTH_CODE_PKCE_GENERATION, 'Generated PKCE challenge and verifier', {
      codeChallenge
    })
  }

  logAuthorizationRequest(authUrl) {
    this.info(OAUTH2_PHASES.AUTH_CODE_AUTHORIZATION_REQUEST, 'Authorization request created', {
      authorizationUrl: authUrl
    })
  }

  logUserAuthorization() {
    this.info(OAUTH2_PHASES.AUTH_CODE_USER_AUTHORIZATION, 'Waiting for user authorization...')
  }

  logCallbackReceived(code, state) {
    this.info(OAUTH2_PHASES.AUTH_CODE_CALLBACK_RECEIVED, 'Authorization callback received', {
      hasCode: !!code,
      state
    })
  }

  logTokenRequest(tokenUrl) {
    this.info(OAUTH2_PHASES.AUTH_CODE_TOKEN_REQUEST, `Requesting access token from: ${tokenUrl}`)
  }

  logAuthCodeFlowComplete(tokenInfo) {
    this.info(OAUTH2_PHASES.AUTH_CODE_COMPLETE, 'Authorization Code Flow completed successfully', {
      hasAccessToken: !!tokenInfo.access_token,
      hasRefreshToken: !!tokenInfo.refresh_token,
      expiresIn: tokenInfo.expires_in
    })
  }

  /**
   * Log token management events
   */
  logTokenStorage(sessionId) {
    this.info(
      OAUTH2_PHASES.TOKEN_STORAGE,
      `Storing access token in MySQL for session: ${sessionId}`
    )
  }

  logTokenRetrieval(sessionId, found) {
    this.debug(OAUTH2_PHASES.TOKEN_RETRIEVAL, `Token retrieval for session: ${sessionId}`, {
      found
    })
  }

  logTokenRefresh(sessionId) {
    this.info(OAUTH2_PHASES.TOKEN_REFRESH, `Refreshing access token for session: ${sessionId}`)
  }

  logTokenValidation(isValid) {
    this.debug(
      OAUTH2_PHASES.TOKEN_VALIDATION,
      `Token validation result: ${isValid ? 'VALID' : 'INVALID'}`
    )
  }

  logTokenExpiration(sessionId) {
    this.warn(OAUTH2_PHASES.TOKEN_EXPIRATION, `Access token expired for session: ${sessionId}`)
  }

  /**
   * Log MCP operations
   */
  logMCPRequestWithToken(endpoint) {
    this.debug(
      OAUTH2_PHASES.MCP_REQUEST_WITH_TOKEN,
      `Making MCP request with OAuth2 token to: ${endpoint}`
    )
  }

  logMCPSuccess(endpoint) {
    this.debug(OAUTH2_PHASES.MCP_RESPONSE_SUCCESS, `MCP request successful: ${endpoint}`)
  }

  logMCPUnauthorized(endpoint) {
    this.warn(
      OAUTH2_PHASES.MCP_RESPONSE_UNAUTHORIZED,
      `MCP request returned 401 Unauthorized: ${endpoint}`
    )
  }

  /**
   * Log errors by phase
   */
  logDiscoveryError(error) {
    this.error(OAUTH2_PHASES.ERROR_DISCOVERY, 'Discovery phase failed', {
      error: error.message,
      stack: error.stack
    })
  }

  logRegistrationError(error) {
    this.error(OAUTH2_PHASES.ERROR_REGISTRATION, 'Registration phase failed', {
      error: error.message,
      stack: error.stack
    })
  }

  logAuthorizationError(error) {
    this.error(OAUTH2_PHASES.ERROR_AUTHORIZATION, 'Authorization phase failed', {
      error: error.message,
      stack: error.stack
    })
  }

  logTokenError(error) {
    this.error(OAUTH2_PHASES.ERROR_TOKEN, 'Token operation failed', {
      error: error.message,
      stack: error.stack
    })
  }

  logMCPError(error) {
    this.error(OAUTH2_PHASES.ERROR_MCP, 'MCP operation failed', {
      error: error.message,
      stack: error.stack
    })
  }
}

export { OAuth2Logger, OAUTH2_PHASES }
