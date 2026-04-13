/* global fetch */

/**
 * OAuth2 Dynamic Client Registration Module
 *
 * Implements Dynamic Client Registration according to:
 * - RFC7591: OAuth 2.0 Dynamic Client Registration Protocol
 *
 * This module handles the registration phase of the OAuth2 flow, where the
 * MCP server dynamically registers itself as an OAuth2 client with the
 * authorization server.
 *
 * NOTE: This implementation supports both dynamic registration and pre-configured
 * client credentials (when dynamic registration is not available).
 */

import { OAuth2Logger } from './logger.js'

/**
 * OAuth2 Client Registration Service
 * Handles dynamic client registration and credential management
 */
export class OAuth2ClientRegistrationService {
  constructor(logger = null) {
    this.logger = logger || new OAuth2Logger()
  }

  /**
   * DYNAMIC REGISTRATION: Register client with authorization server
   *
   * According to RFC7591, this sends a registration request to the
   * authorization server's registration endpoint to obtain client credentials.
   *
   * Request payload includes:
   * - redirect_uris: Array of valid redirect URIs for this client
   * - client_name: Human-readable client name
   * - grant_types: OAuth grant types this client will use
   * - response_types: OAuth response types this client expects
   * - token_endpoint_auth_method: How client authenticates to token endpoint
   *
   * Response includes:
   * - client_id: Unique client identifier
   * - client_secret: Client secret (for confidential clients)
   * - client_id_issued_at: Timestamp when client_id was issued
   * - client_secret_expires_at: When client_secret expires (0 = never)
   *
   * @param {string} registrationEndpoint - URL of the registration endpoint
   * @param {Array<string>} redirectUris - Valid redirect URIs for this client
   * @param {Object} options - Additional registration options
   * @returns {Object} Client credentials (client_id, client_secret, etc.)
   */
  async registerClient(registrationEndpoint, redirectUris, options = {}) {
    if (!registrationEndpoint) {
      throw new Error('Registration endpoint is required for dynamic registration')
    }

    if (!redirectUris || redirectUris.length === 0) {
      throw new Error('At least one redirect URI is required')
    }

    this.logger.logRegistrationStart()

    // Build registration request per RFC7591
    const registrationRequest = {
      redirect_uris: redirectUris,
      client_name: options.clientName || 'Movida MCP Server (OAuth2)',
      grant_types: options.grantTypes || ['authorization_code', 'refresh_token'],
      response_types: options.responseTypes || ['code'],
      token_endpoint_auth_method: options.tokenEndpointAuthMethod || 'client_secret_basic',
      // Additional metadata
      application_type: 'web',
      ...(options.scope && { scope: options.scope })
    }

    this.logger.logRegistrationRequest(registrationEndpoint, registrationRequest)

    try {
      const response = await fetch(registrationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(registrationRequest)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `Dynamic Client Registration failed: ${response.status} ${response.statusText}\n${errorBody}`
        )
      }

      const clientCredentials = await response.json()

      // Validate response per RFC7591
      if (!clientCredentials.client_id) {
        throw new Error('Registration response missing client_id')
      }

      this.logger.logRegistrationComplete(clientCredentials.client_id)

      return {
        clientId: clientCredentials.client_id,
        clientSecret: clientCredentials.client_secret || null,
        issuedAt: clientCredentials.client_id_issued_at,
        secretExpiresAt: clientCredentials.client_secret_expires_at,
        registrationAccessToken: clientCredentials.registration_access_token,
        registrationClientUri: clientCredentials.registration_client_uri,
        rawResponse: clientCredentials
      }
    } catch (error) {
      this.logger.logRegistrationError(error)
      throw error
    }
  }

  /**
   * PRE-CONFIGURED CLIENT: Load client credentials from configuration
   *
   * When dynamic registration is not supported by the authorization server,
   * or when using pre-registered client credentials, this method loads
   * the credentials from the provided configuration.
   *
   * This is useful for:
   * - Authorization servers that don't support RFC7591
   * - Production environments with pre-registered clients
   * - Development/testing with known client credentials
   *
   * @param {Object} config - Client configuration
   * @param {string} config.clientId - Pre-registered client ID
   * @param {string} config.clientSecret - Pre-registered client secret
   * @returns {Object} Client credentials object
   */
  loadPreConfiguredClient(config) {
    if (!config || !config.clientId) {
      throw new Error('Pre-configured client requires clientId')
    }

    this.logger.info('REGISTRATION_START', 'Using pre-configured client credentials', {
      clientId: config.clientId
    })

    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret || null,
      isPreConfigured: true
    }
  }

  /**
   * Determine and execute appropriate registration strategy
   *
   * This method decides whether to use dynamic registration or pre-configured
   * credentials based on what's available:
   *
   * 1. If pre-configured credentials exist, use them
   * 2. Otherwise, attempt dynamic registration (if endpoint available)
   * 3. Throw error if neither option is available
   *
   * @param {Object} options - Registration options
   * @param {string} options.registrationEndpoint - Registration endpoint (optional)
   * @param {Array<string>} options.redirectUris - Redirect URIs for registration
   * @param {string} options.preConfiguredClientId - Pre-configured client ID (optional)
   * @param {string} options.preConfiguredClientSecret - Pre-configured client secret (optional)
   * @returns {Object} Client credentials
   */
  async obtainClientCredentials(options) {
    const {
      registrationEndpoint,
      redirectUris,
      preConfiguredClientId,
      preConfiguredClientSecret,
      ...registrationOptions
    } = options

    // Strategy 1: Use pre-configured credentials if available
    if (preConfiguredClientId) {
      return this.loadPreConfiguredClient({
        clientId: preConfiguredClientId,
        clientSecret: preConfiguredClientSecret
      })
    }

    // Strategy 2: Attempt dynamic registration
    if (registrationEndpoint) {
      return await this.registerClient(registrationEndpoint, redirectUris, registrationOptions)
    }

    // No valid strategy available
    throw new Error(
      'Cannot obtain client credentials: neither pre-configured credentials nor ' +
        'registration endpoint provided. Please either:\n' +
        '1. Configure OAUTH2_CLIENT_ID and OAUTH2_CLIENT_SECRET in .env, OR\n' +
        '2. Ensure the authorization server supports dynamic client registration (RFC7591)'
    )
  }
}
