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
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as logger from '#src/services/logger.js'
import { setSessionContext } from '#src/services/tracing.js'

interface McpConfig {
  name: string
  createServer: (options: { sessionId: string; getAccessToken: () => Promise<string> }) => McpServer
}

interface StdioServerConfig {
  accessToken: string
  mcp: McpConfig
}

export class StdioServer {
  private accessToken: string
  private mcp: McpConfig
  private sessionId: string
  private server: McpServer | null

  constructor({ accessToken, mcp }: StdioServerConfig) {
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

  /** Get access token from environment */
  async getAccessToken(): Promise<string> {
    return this.accessToken
  }

  /** Start the server */
  async start(): Promise<void> {
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
