/* global fetch */

/**
 * OAuth2 Discovery Module
 *
 * Implements OAuth2 server discovery according to:
 * - RFC9728: OAuth 2.0 Protected Resource Metadata
 * - RFC8414: OAuth 2.0 Authorization Server Metadata
 *
 * This module handles the discovery phase of the OAuth2 flow, which consists of:
 * 1. Receiving 401 Unauthorized with WWW-Authenticate header from MCP server
 * 2. Fetching Protected Resource Metadata from MCP server
 * 3. Extracting Authorization Server URL from metadata
 * 4. Fetching Authorization Server Metadata
 */

import { OAuth2Logger } from './logger.js'

/**
 * OAuth2 Discovery Service
 * Handles all server discovery operations
 */
export class OAuth2DiscoveryService {
  constructor(logger = null) {
    this.logger = logger || new OAuth2Logger()
  }

  /**
   * PHASE 1: Parse WWW-Authenticate header from 401 response
   *
   * According to RFC9728 Section 5.1, when an MCP server returns 401 Unauthorized,
   * it MUST include a WWW-Authenticate header indicating the location of the
   * Protected Resource Metadata document.
   *
   * Example header:
   * WWW-Authenticate: Bearer realm="MCP Server",
   *                   resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"
   *
   * @param {string} wwwAuthenticateHeader - The WWW-Authenticate header value
   * @returns {Object} Parsed authentication challenge with resource_metadata URL
   */
  parseWWWAuthenticateHeader(wwwAuthenticateHeader) {
    if (!wwwAuthenticateHeader) {
      throw new Error('WWW-Authenticate header is missing')
    }

    // Parse Bearer token challenge
    const parts = wwwAuthenticateHeader.split(',').map((p) => p.trim())
    const params = {}

    parts.forEach((part) => {
      const match = part.match(/(\w+)="([^"]+)"/)
      if (match) {
        params[match[1]] = match[2]
      }
    })

    if (!params.resource_metadata) {
      throw new Error('WWW-Authenticate header missing resource_metadata parameter')
    }

    this.logger.debug('DISCOVERY_START', 'Parsed WWW-Authenticate header', {
      resourceMetadataUrl: params.resource_metadata
    })

    return params
  }

  /**
   * PHASE 2: Fetch Protected Resource Metadata
   *
   * According to RFC9728, the Protected Resource Metadata document describes
   * the protected resource and identifies its authorization servers.
   *
   * Standard location: /.well-known/oauth-protected-resource
   *
   * Expected response structure:
   * {
   *   "resource": "https://mcp.example.com",
   *   "authorization_servers": ["https://auth.example.com"]
   * }
   *
   * @param {string} resourceMetadataUrl - URL to fetch Protected Resource Metadata
   * @returns {Object} Protected Resource Metadata
   */
  async fetchProtectedResourceMetadata(resourceMetadataUrl) {
    this.logger.logDiscoveryStart()

    try {
      this.logger.debug('resourceMetadataUrl', resourceMetadataUrl)

      const response = await fetch(resourceMetadataUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Protected Resource Metadata: ${response.status} ${response.statusText}`
        )
      }

      const metadata = await response.json()

      // Validate required fields per RFC9728
      if (!metadata.authorization_servers || metadata.authorization_servers.length === 0) {
        throw new Error('Protected Resource Metadata missing authorization_servers')
      }

      this.logger.logProtectedResourceMetadata(resourceMetadataUrl, metadata)

      return metadata
    } catch (error) {
      this.logger.logDiscoveryError(error)
      throw error
    }
  }

  /**
   * PHASE 3: Fetch Authorization Server Metadata
   *
   * According to RFC8414, Authorization Server Metadata provides information
   * about the authorization server's endpoints and capabilities.
   *
   * Standard location: {issuer}/.well-known/oauth-authorization-server
   *
   * Expected response includes:
   * - issuer: Authorization server's identifier
   * - authorization_endpoint: URL for authorization requests
   * - token_endpoint: URL for token requests
   * - registration_endpoint: URL for dynamic client registration (optional)
   * - scopes_supported: Supported OAuth scopes
   * - response_types_supported: Supported response types
   * - grant_types_supported: Supported grant types
   *
   * @param {string} authServerUrl - Base URL of the authorization server
   * @returns {Object} Authorization Server Metadata
   */
  async fetchAuthorizationServerMetadata(authServerUrl) {
    // Construct well-known URL per RFC8414
    const metadataUrl = `${authServerUrl}/.well-known/oauth-authorization-server`

    try {
      const response = await fetch(metadataUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Authorization Server Metadata: ${response.status} ${response.statusText}`
        )
      }

      const metadata = await response.json()

      // Validate required fields per RFC8414
      const requiredFields = ['issuer', 'authorization_endpoint', 'token_endpoint']
      for (const field of requiredFields) {
        if (!metadata[field]) {
          throw new Error(`Authorization Server Metadata missing required field: ${field}`)
        }
      }

      this.logger.logAuthServerMetadata(metadataUrl, metadata)

      return metadata
    } catch (error) {
      this.logger.logDiscoveryError(error)
      throw error
    }
  }

  /**
   * Complete Discovery Flow
   *
   * Orchestrates the full discovery process:
   * 1. Parse WWW-Authenticate header (if provided)
   * 2. Fetch Protected Resource Metadata
   * 3. Select Authorization Server (uses first one)
   * 4. Fetch Authorization Server Metadata
   *
   * @param {Object} options - Discovery options
   * @param {string} options.resourceMetadataUrl - Optional: Direct URL to Protected Resource Metadata
   * @param {string} options.wwwAuthenticateHeader - Optional: WWW-Authenticate header to parse
   * @param {string} options.mcpServerUrl - Optional: MCP server base URL (will construct well-known URL)
   * @returns {Object} Discovery results with authorization server metadata
   */
  async performDiscovery(options = {}) {
    const { resourceMetadataUrl, wwwAuthenticateHeader, mcpServerUrl } = options

    let resourceUrl

    // Determine resource metadata URL
    if (resourceMetadataUrl) {
      resourceUrl = resourceMetadataUrl
    } else if (wwwAuthenticateHeader) {
      const authParams = this.parseWWWAuthenticateHeader(wwwAuthenticateHeader)
      resourceUrl = authParams.resource_metadata
    } else if (mcpServerUrl) {
      // Construct standard well-known URL
      resourceUrl = `${mcpServerUrl}/.well-known/oauth-protected-resource`
    } else {
      throw new Error(
        'Must provide either resourceMetadataUrl, wwwAuthenticateHeader, or mcpServerUrl'
      )
    }

    // Step 1: Fetch Protected Resource Metadata
    const protectedResourceMetadata = await this.fetchProtectedResourceMetadata(resourceUrl)

    // Step 2: Select Authorization Server
    // Per RFC9728 Section 7.6, client determines which AS to use
    // For simplicity, we use the first one
    const authServerUrl = protectedResourceMetadata.authorization_servers[0]

    if (!authServerUrl) {
      throw new Error('No authorization server found in Protected Resource Metadata')
    }

    // Step 3: Fetch Authorization Server Metadata
    const authServerMetadata = await this.fetchAuthorizationServerMetadata(authServerUrl)

    this.logger.logDiscoveryComplete()

    return {
      protectedResourceMetadata,
      authServerUrl,
      authServerMetadata,
      // Convenience fields for downstream use
      authorizationEndpoint: authServerMetadata.authorization_endpoint,
      tokenEndpoint: authServerMetadata.token_endpoint,
      registrationEndpoint: authServerMetadata.registration_endpoint
    }
  }
}
