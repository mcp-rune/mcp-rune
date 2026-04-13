/**
 * OAuth2 Local Flow Handler
 *
 * Implements the local authentication flow for stdio transport:
 * 1. Start temporary HTTP server on localhost
 * 2. Open user's browser to authorization URL
 * 3. Wait for OAuth callback
 * 4. Exchange authorization code for tokens
 * 5. Return token response
 *
 * This is required for MCP clients like Claude Desktop, Cursor, etc.
 * that spawn MCP servers as child processes using stdio transport.
 */

import http from 'node:http'
import open from 'open'

export class OAuth2LocalFlowHandler {
  /**
   * @param {Object} config
   * @param {Object} config.orchestrator - OAuth2Orchestrator instance
   * @param {string} config.redirectUri - OAuth callback URI (e.g., http://localhost:3456/callback)
   * @param {string} [config.resourceUri] - RFC8707 resource URI for token binding
   */
  constructor({ orchestrator, redirectUri, resourceUri }) {
    this.orchestrator = orchestrator
    this.redirectUri = redirectUri
    this.resourceUri = resourceUri
    this.logger = orchestrator.logger
  }

  /**
   * Start local authentication flow
   *
   * Opens browser and waits for callback
   *
   * @param {string} sessionId - MCP session identifier
   * @returns {Promise<Object>} Token response with accessToken, refreshToken, etc.
   */
  async startLocalFlow(sessionId) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.redirectUri)
      const port = parseInt(url.port || '3456', 10)

      this.logger.info('AUTH_CODE_START', `Starting local OAuth flow for session: ${sessionId}`, {
        port,
        redirectUri: this.redirectUri
      })

      // Start authorization flow (generates PKCE, state, etc.)
      const authRequest = this.orchestrator.startAuthorizationFlow(sessionId)

      // Create temporary HTTP server to receive callback
      const server = http.createServer(async (req, res) => {
        const callbackUrl = new URL(req.url, this.redirectUri)

        // Only handle our callback path
        if (callbackUrl.pathname !== url.pathname) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not found')
          return
        }

        // Extract OAuth callback parameters
        const code = callbackUrl.searchParams.get('code')
        const state = callbackUrl.searchParams.get('state')
        const error = callbackUrl.searchParams.get('error')
        const errorDescription = callbackUrl.searchParams.get('error_description')

        // Handle error response
        if (error) {
          this.logger.error('ERROR_AUTHORIZATION', 'Authorization failed', {
            error,
            errorDescription
          })

          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                  h1 { color: #d32f2f; }
                  p { color: #666; }
                </style>
              </head>
              <body>
                <h1>Authentication Failed</h1>
                <p><strong>Error:</strong> ${error}</p>
                ${errorDescription ? `<p>${errorDescription}</p>` : ''}
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `)

          server.close()
          reject(new Error(`OAuth2 authorization failed: ${errorDescription || error}`))
          return
        }

        // Validate code and state
        if (!code || !state) {
          const msg = 'Missing code or state parameter in callback'
          this.logger.error('ERROR_AUTHORIZATION', msg)

          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body>
                <h1>Invalid Callback</h1>
                <p>${msg}</p>
              </body>
            </html>
          `)

          server.close()
          reject(new Error(msg))
          return
        }

        try {
          // Exchange authorization code for access token
          this.logger.info(
            'AUTH_CODE_TOKEN_REQUEST',
            'Exchanging authorization code for access token',
            { sessionId }
          )

          const result = await this.orchestrator.exchangeCodeForToken(code, state)

          this.logger.info('AUTH_CODE_COMPLETE', 'Local OAuth flow completed successfully', {
            sessionId,
            hasAccessToken: !!result.accessToken,
            hasRefreshToken: !!result.tokenResponse.refreshToken
          })

          // Send success page
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head>
                <title>Authentication Successful</title>
                <style>
                  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                  h1 { color: #2e7d32; }
                  p { color: #666; }
                  .success { background: #e8f5e9; padding: 15px; border-radius: 4px; margin: 20px 0; }
                </style>
              </head>
              <body>
                <h1>✓ Authentication Successful</h1>
                <div class="success">
                  <p><strong>You are now authenticated!</strong></p>
                  <p>Session ID: <code>${sessionId}</code></p>
                </div>
                <p>You can close this window and return to your terminal.</p>
              </body>
            </html>
          `)

          server.close()
          resolve(result.tokenResponse)
        } catch (err) {
          this.logger.error('ERROR_TOKEN', 'Token exchange failed', {
            error: err.message,
            stack: err.stack
          })

          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <head>
                <title>Token Exchange Failed</title>
                <style>
                  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                  h1 { color: #d32f2f; }
                  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
                </style>
              </head>
              <body>
                <h1>Token Exchange Failed</h1>
                <p>Failed to exchange authorization code for access token.</p>
                <p><code>${err.message}</code></p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `)

          server.close()
          reject(err)
        }
      })

      // Start server
      server.listen(port, async () => {
        this.logger.info(
          'AUTH_CODE_USER_AUTHORIZATION',
          `OAuth callback server listening on port ${port}`,
          { redirectUri: this.redirectUri }
        )

        this.logger.info(
          'AUTH_CODE_AUTHORIZATION_REQUEST',
          'Opening browser for user authorization',
          { authUrl: authRequest.authorizationUrl }
        )

        // Open browser to authorization URL
        try {
          await open(authRequest.authorizationUrl)
        } catch (err) {
          // If we can't open the browser, log the URL for manual opening
          this.logger.warn(
            'AUTH_CODE_AUTHORIZATION_REQUEST',
            'Could not open browser automatically. Please navigate manually.',
            { error: err.message }
          )

          console.error('\n' + '='.repeat(80))
          console.error('Could not open browser automatically.')
          console.error('Please open this URL in your browser to authenticate:')
          console.error('\n' + authRequest.authorizationUrl + '\n')
          console.error('='.repeat(80) + '\n')
        }
      })

      // Handle server errors
      server.on('error', (err) => {
        this.logger.error('ERROR_AUTHORIZATION', 'OAuth callback server error', {
          error: err.message
        })

        reject(new Error(`Failed to start callback server: ${err.message}`))
      })

      // Timeout after 5 minutes
      const timeout = setTimeout(
        () => {
          this.logger.warn(
            'AUTH_CODE_START',
            'Authentication timeout - no callback received within 5 minutes'
          )

          server.close()
          reject(new Error('Authentication timeout - no callback received within 5 minutes'))
        },
        5 * 60 * 1000
      )

      // Clear timeout when server closes
      server.on('close', () => {
        clearTimeout(timeout)
      })
    })
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
}
