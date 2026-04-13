/* global fetch, URLSearchParams */

/**
 * OAuth2 User Info Service
 *
 * Fetches user information from the authorization server's userinfo endpoint.
 * Implements OpenID Connect UserInfo endpoint specification.
 *
 * According to:
 * - OpenID Connect Core 1.0 Section 5.3: UserInfo Endpoint
 * - RFC6750: Bearer Token Usage
 */

export class OAuth2UserInfoService {
  /**
   * @param {Object} config
   * @param {Object} config.orchestrator - OAuth2Orchestrator instance
   */
  constructor({ orchestrator }) {
    this.orchestrator = orchestrator
    this.logger = orchestrator.logger
  }

  /**
   * Fetch user information from authorization server
   *
   * @param {string} accessToken - Valid access token
   * @returns {Promise<Object>} User info object
   */
  async getUserInfo(accessToken) {
    if (!accessToken) {
      throw new Error('Access token is required to fetch user info')
    }

    // Get userinfo endpoint from authorization server metadata
    const userInfoEndpoint = this._getUserInfoEndpoint()

    if (!userInfoEndpoint) {
      this.logger.warn(
        'USER_INFO_FETCH',
        'Authorization server does not provide userinfo_endpoint. Using token introspection fallback.'
      )

      // Fallback: Try to extract user info from token introspection
      return this._getUserInfoFromIntrospection(accessToken)
    }

    this.logger.info('USER_INFO_FETCH', 'Fetching user info from authorization server', {
      endpoint: userInfoEndpoint
    })

    try {
      const response = await fetch(userInfoEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `Failed to fetch user info: ${response.status} ${response.statusText}\n${errorBody}`
        )
      }

      const userInfo = await response.json()

      this.logger.info('USER_INFO_SUCCESS', 'User info retrieved successfully', {
        sub: userInfo.sub,
        email: userInfo.email,
        hasEmail: !!userInfo.email,
        hasName: !!userInfo.name
      })

      // Normalize user info format
      return this._normalizeUserInfo(userInfo)
    } catch (error) {
      this.logger.error('USER_INFO_ERROR', 'Failed to fetch user info', {
        error: error.message,
        stack: error.stack
      })
      throw error
    }
  }

  /**
   * Get userinfo endpoint from authorization server metadata
   * @private
   */
  _getUserInfoEndpoint() {
    if (!this.orchestrator.oauth2Metadata) {
      throw new Error('OAuth2 metadata not available. Call discoverOAuth2Endpoints() first.')
    }

    const metadata = this.orchestrator.oauth2Metadata.authServerMetadata

    if (!metadata) {
      throw new Error('Authorization server metadata not available')
    }

    return metadata.userinfo_endpoint || null
  }

  /**
   * Normalize user info to consistent format
   *
   * Different authorization servers return slightly different formats.
   * This normalizes to a standard format expected by MCP servers.
   *
   * @private
   */
  _normalizeUserInfo(userInfo) {
    return {
      // Standard OIDC claims
      sub: userInfo.sub,
      id: userInfo.sub, // Alias for compatibility
      email: userInfo.email || null,
      email_verified: userInfo.email_verified || false,
      name: userInfo.name || null,
      given_name: userInfo.given_name || null,
      family_name: userInfo.family_name || null,
      picture: userInfo.picture || null,
      locale: userInfo.locale || null,

      // Include all original claims
      ...userInfo
    }
  }

  /**
   * Fallback: Get user info from token introspection
   *
   * Some authorization servers don't provide a userinfo endpoint.
   * In this case, we can try token introspection to get basic user info.
   *
   * @private
   */
  async _getUserInfoFromIntrospection(accessToken) {
    const metadata = this.orchestrator.oauth2Metadata?.authServerMetadata

    if (!metadata?.introspection_endpoint) {
      // Last resort: Return minimal user info from token
      this.logger.warn(
        'USER_INFO_FETCH',
        'No userinfo or introspection endpoint available. Returning minimal user info.'
      )

      return {
        sub: 'unknown',
        id: 'unknown',
        email: null,
        name: null
      }
    }

    this.logger.info('USER_INFO_FETCH', 'Using token introspection as fallback for user info', {
      endpoint: metadata.introspection_endpoint
    })

    try {
      const response = await fetch(metadata.introspection_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: this._getClientAuthHeader()
        },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: 'access_token'
        }).toString()
      })

      if (!response.ok) {
        throw new Error(`Token introspection failed: ${response.status}`)
      }

      const introspection = await response.json()

      if (!introspection.active) {
        throw new Error('Token is not active')
      }

      // Extract user info from introspection response
      return {
        sub: introspection.sub || introspection.username || 'unknown',
        id: introspection.sub || introspection.username || 'unknown',
        email: introspection.email || null,
        name: introspection.name || null,
        username: introspection.username || null,
        scope: introspection.scope || null
      }
    } catch (error) {
      this.logger.error('USER_INFO_ERROR', 'Token introspection failed', { error: error.message })

      // Return minimal info
      return {
        sub: 'unknown',
        id: 'unknown',
        email: null,
        name: null
      }
    }
  }

  /**
   * Get client authentication header for introspection
   * @private
   */
  _getClientAuthHeader() {
    const credentials = this.orchestrator.clientCredentials

    if (!credentials) {
      return ''
    }

    if (credentials.clientSecret) {
      // HTTP Basic Auth
      const encoded = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
        'base64'
      )
      return `Basic ${encoded}`
    }

    return ''
  }
}
