/**
 * StdioServer - Stdio server that hosts MCP endpoints
 *
 * Handles stdio transport concerns while delegating MCP server creation
 * to an injected factory. This decouples stdio transport from MCP server
 * configuration.
 *
 * For local development with tools like Claude Code or OpenCode that spawn
 * child processes.
 *
 * Authentication:
 *   Per MCP spec, STDIO transport SHOULD NOT use OAuth. Instead, credentials
 *   are retrieved from the environment via `accessToken` config parameter.
 *
 * @see https://modelcontextprotocol.io/specification/draft/basic/authorization
 */

import { randomUUID } from 'crypto'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as logger from '#lib/services/logger.js'
import { setSessionContext } from '#lib/services/tracing.js'

export class StdioServer {
  /**
   * @param {Object} config
   * @param {string} config.accessToken - Access token from environment (required per MCP spec)
   * @param {Object} config.mcp - MCP server configuration
   * @param {string} config.mcp.name - Server name for logging (e.g., 'engineer-mcp')
   * @param {Function} config.mcp.createServer - Factory: ({ sessionId, getAccessToken }) => Server
   */
  constructor({ accessToken, mcp }) {
    if (!accessToken) {
      throw new Error(
        'StdioServer requires accessToken from environment. ' +
          'Per MCP spec, STDIO transport should use environment credentials, not OAuth. ' +
          'Set the access token in your MCP client configuration.'
      )
    }

    this.accessToken = accessToken
    this.mcp = mcp

    // Generate cryptographically secure session ID for this MCP instance
    this.sessionId = `local-${randomUUID()}`
    this.server = null
  }

  /**
   * Get access token from environment
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    return this.accessToken
  }

  /**
   * Start the server
   */
  async start() {
    logger.info(`${this.mcp.name} (stdio) starting`, {
      service: this.mcp.name,
      sessionId: this.sessionId
    })

    // Create MCP server with getAccessToken bound to this instance
    this.server = this.mcp.createServer({
      sessionId: this.sessionId,
      getAccessToken: this.getAccessToken.bind(this)
    })

    const transport = new StdioServerTransport()
    await this.server.connect(transport)

    setSessionContext({
      sessionId: this.sessionId,
      metadata: { transport: 'stdio' }
    })

    logger.info(`${this.mcp.name} (stdio) running`, { service: this.mcp.name })
  }
}
