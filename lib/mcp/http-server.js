/**
 * HttpServer - HTTP server that hosts MCP endpoints
 *
 * Handles HTTP concerns (Express, CORS, rate limiting) while delegating
 * MCP server creation to an injected factory.
 *
 * Supports two authentication modes:
 * - **OAuth mode**: Full OAuth2 with token introspection (via oauth-router)
 * - **Token mode**: No MCP auth; uses a static ACCESS_TOKEN for API calls only
 *
 * Implements:
 * - MCP Streamable HTTP transport (spec 2025-06-18)
 * - RFC9728: OAuth 2.0 Protected Resource Metadata (OAuth mode only)
 * - RFC8707: Resource Indicators for OAuth 2.0 (OAuth mode only)
 */

import { randomUUID, createHash } from 'crypto'
import express from 'express'
import cors from 'cors'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as logger from '#lib/services/logger.js'
import { setSessionContext, flushTracing, closeTracing } from '#lib/services/tracing.js'
import { createRequestIdMiddleware } from './middleware/request-id.js'
import { createRequestLoggerMiddleware } from './middleware/request-logger.js'
import {
  createOAuthRouter,
  extractBearerToken,
  sendUnauthorized
} from './middleware/oauth-router.js'

export class HttpServer {
  /**
   * @param {Object} config
   * @param {number} config.port - Port to listen on
   * @param {string} [config.baseUrl] - Base URL for this server (e.g., 'https://mcp.example.com')
   * @param {string} [config.pathPrefix] - Path prefix for all routes (e.g., '/engineer-mcp')
   * @param {import('#lib/oauth2/service.js').OAuthService} [config.oauth] - OAuth service (OAuth mode)
   * @param {string} [config.accessToken] - Static access token for API calls (token mode)
   * @param {Object} config.mcp - MCP server configuration
   * @param {string} config.mcp.name - Server name for logging (e.g., 'engineer-mcp')
   * @param {Function} config.mcp.createServer - Factory: ({ sessionId, getAccessToken }) => Server
   * @param {Object} [config.mcp.promptRegistry] - Optional prompt registry for cache stats
   * @param {boolean} [config.isProduction] - Whether running in production
   * @param {string} [config.corsOrigins] - Comma-separated CORS origins string
   */
  constructor({ port, baseUrl, pathPrefix, oauth, accessToken, mcp, isProduction, corsOrigins }) {
    if (!oauth && !accessToken) {
      throw new Error('HttpServer requires either oauth (OAuth mode) or accessToken (token mode)')
    }
    if (oauth && accessToken) {
      throw new Error('HttpServer cannot use both oauth and accessToken — choose one mode')
    }

    this.port = port
    this.oauth = oauth || null
    this.accessToken = accessToken || null
    this.mcp = mcp

    // Path prefix for all routes (defaults to empty string for no prefix)
    this.pathPrefix = pathPrefix || ''

    // Base URL for this server (used for well-known endpoints)
    // In production, this should be the public URL (e.g., 'https://dsaenz.dev/mcp')
    this.baseUrl = baseUrl || `http://localhost:${this.port}`

    // Session storage: sessionId -> { transport, server, accessToken }
    this.sessions = new Map()

    // Environment flags — injected, no process.env reads
    this._isProduction = isProduction ?? false
    this._isDevelopment = !this._isProduction
    this._corsOrigins = corsOrigins

    // Express app
    this.app = express()

    this._setupMiddleware()
    this._registerRoutes()
  }

  /**
   * Setup Express middleware
   */
  _setupMiddleware() {
    // Security headers - protect against common web vulnerabilities
    this.app.use((req, res, next) => {
      // Prevent clickjacking attacks
      res.setHeader('X-Frame-Options', 'DENY')
      // Prevent MIME type sniffing
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // Enable XSS filter in browsers
      res.setHeader('X-XSS-Protection', '1; mode=block')
      // Enforce HTTPS in production (HSTS)
      if (this._isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      }
      next()
    })

    // CORS: Configure cross-origin requests
    const corsOriginsList = this._corsOrigins
      ? this._corsOrigins.split(',').map((o) => o.trim())
      : undefined
    let corsOriginConfig
    if (corsOriginsList) {
      corsOriginConfig = corsOriginsList
    } else if (this._isProduction) {
      logger.warn('CORS_ORIGINS not set in production — cross-origin requests will be blocked', {
        service: this.mcp?.name
      })
      corsOriginConfig = false
    } else {
      corsOriginConfig = true
    }

    this.app.use(
      cors({
        origin: corsOriginConfig,
        // Don't send credentials (cookies) in cross-origin requests
        credentials: false,
        // Allowed methods for MCP
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        // Allowed headers
        allowedHeaders: [
          'Authorization',
          'Content-Type',
          'X-Request-ID',
          'Mcp-Session-Id',
          'MCP-Protocol-Version'
        ],
        // Expose headers to browser JavaScript
        exposedHeaders: ['mcp-session-id', 'X-Request-ID']
      })
    )

    // Rate limiting: Prevent abuse and DoS attacks
    // Limits per user/IP: 100 requests per 15 minutes for MCP endpoint
    const mcpLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 100,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Too many requests, please try again later' },
        id: null
      },
      keyGenerator: (req) => {
        // Use SHA-256 hash of Bearer token for per-user limiting, otherwise IP
        // Using crypto hash instead of base64 for security (prevents collision attacks)
        const token = req.headers['authorization']?.slice(7)
        if (token) {
          const hash = createHash('sha256').update(token).digest('hex').slice(0, 16)
          return `token:${hash}`
        }
        return ipKeyGenerator(req.ip)
      }
    })
    this.app.use(`${this.pathPrefix}/mcp`, mcpLimiter)

    // Body parsers with size limits to prevent DoS via large payloads
    // 100kb should be sufficient for MCP JSON-RPC requests
    this.app.use(express.json({ limit: '100kb' }))
    // Parse URL-encoded bodies (OAuth token requests use application/x-www-form-urlencoded)
    this.app.use(express.urlencoded({ extended: true, limit: '10kb' }))

    // Request ID middleware - enables distributed tracing
    this.app.use(createRequestIdMiddleware())

    // Request logging middleware
    this.app.use(createRequestLoggerMiddleware())
  }

  /**
   * Wrap async route handlers to catch errors and forward to error middleware
   */
  _asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next)
    }
  }

  /**
   * Register all HTTP routes
   */
  _registerRoutes() {
    const prefix = this.pathPrefix

    // OAuth routes (well-known endpoints, token, register, etc.) — OAuth mode only
    if (this.oauth) {
      const oauthRouter = createOAuthRouter({
        oauth: this.oauth,
        baseUrl: this.baseUrl,
        mcpName: this.mcp.name
      })
      this.app.use(prefix, oauthRouter)
    }

    // Health check
    this.app.get(`${prefix}/health`, this._handleHealth.bind(this))

    // Cache stats (optional, only if prompt registry supports it)
    if (this.mcp.promptRegistry?.getStats) {
      this.app.get(`${prefix}/cache-stats`, this._handleCacheStats.bind(this))
    }

    // MCP transport endpoint
    this.app.all(`${prefix}/mcp`, this._asyncHandler(this._handleMcp.bind(this)))

    // Also handle MCP requests at the base path (for Claude Desktop compatibility)
    // Claude Desktop expects MCP endpoint at the base URL, not /mcp subpath
    if (prefix) {
      this.app.all(prefix, this._asyncHandler(this._handleMcp.bind(this)))
    }

    // Legacy SSE endpoint - deprecated
    this.app.get(`${prefix}/sse`, this._handleLegacySse.bind(this))

    // Error handling middleware (must be registered last)
    this.app.use((err, req, res, _next) => {
      logger.error('Unhandled error', {
        service: this.mcp.name,
        method: req.method,
        path: req.path,
        requestId: req.requestId,
        error: err.message,
        stack: err.stack
      })

      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      })
    })
  }

  /**
   * Health check endpoint
   */
  _handleHealth(req, res) {
    const health = {
      status: 'ok',
      service: this.mcp.name,
      transport: 'streamable-http',
      activeSessions: this.sessions.size
    }

    // Include cache stats if available
    if (this.mcp.promptRegistry?.getStats) {
      health.promptCache = this.mcp.promptRegistry.getStats()
    }

    res.json(health)
  }

  /**
   * Cache statistics endpoint
   */
  _handleCacheStats(req, res) {
    if (!this.mcp.promptRegistry?.getStats) {
      return res.status(404).json({ error: 'Cache stats not available' })
    }

    res.json({
      service: this.mcp.name,
      cache: this.mcp.promptRegistry.getStats()
    })
  }

  /**
   * MCP endpoint - Streamable HTTP transport
   *
   * In OAuth mode: authorization MUST be included in every HTTP request (per MCP spec).
   * In token mode: no MCP auth; static ACCESS_TOKEN used for API calls only.
   */
  async _handleMcp(req, res) {
    // Disable socket timeout for long-lived SSE connections
    req.socket.setTimeout(0)

    // --- Authentication ---
    let requestAccessToken

    if (this.oauth) {
      // OAuth mode: validate Bearer token via introspection
      const bearerToken = extractBearerToken(req)
      if (!bearerToken) {
        logger.info('No Bearer token in request', {
          service: this.mcp.name,
          method: req.method,
          requestId: req.requestId
        })
        return sendUnauthorized(req, res, this.baseUrl)
      }

      const introspection = await this.oauth.introspectToken(bearerToken)
      if (!introspection.active) {
        logger.info('Token introspection failed - token inactive', {
          service: this.mcp.name,
          method: req.method,
          requestId: req.requestId
        })
        return sendUnauthorized(req, res, this.baseUrl)
      }

      requestAccessToken = bearerToken
    } else {
      // Token mode: no MCP auth, use static token for API calls
      requestAccessToken = this.accessToken
    }

    const sessionId = req.headers['mcp-session-id']

    if (req.method === 'POST') {
      // Log the MCP method being called (JSON-RPC method from body)
      const mcpMethod = req.body?.method
      if (mcpMethod) {
        logger.info('MCP request', {
          service: this.mcp.name,
          method: mcpMethod,
          sessionId: sessionId || 'new',
          requestId: req.requestId
        })
      }

      const session = sessionId ? this.sessions.get(sessionId) : null

      if (session) {
        // Update access token if it changed (e.g., token refresh) — OAuth mode only
        if (this.oauth && requestAccessToken !== session.accessToken) {
          session.accessToken = requestAccessToken
          logger.debug('Session access token updated', {
            service: this.mcp.name,
            sessionId,
            requestId: req.requestId
          })
        }
        await session.transport.handleRequest(req, res, req.body)
        return
      }

      const currentRequestId = req.requestId
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (newSessionId) => {
          // Create a session object that will hold the mutable accessToken
          const session = { transport, server: null, accessToken: requestAccessToken }

          // getAccessToken: in OAuth mode reads from session (allows token updates),
          // in token mode returns the static token
          const getAccessToken = this.oauth
            ? async () => this.sessions.get(newSessionId)?.accessToken
            : async () => this.accessToken

          const mcpServer = this.mcp.createServer({
            sessionId: newSessionId,
            getAccessToken
          })
          await mcpServer.connect(transport)

          // Store session with server reference
          session.server = mcpServer
          this.sessions.set(newSessionId, session)

          setSessionContext({
            sessionId: newSessionId,
            metadata: { transport: 'streamable-http' }
          })

          logger.info('New MCP session created', {
            service: this.mcp.name,
            sessionId: newSessionId,
            requestId: currentRequestId
          })
        }
      })

      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid) {
          logger.info('MCP session closed', { service: this.mcp.name, sessionId: sid })
          this.sessions.delete(sid)
        }
      }

      await transport.handleRequest(req, res, req.body)
    } else if (req.method === 'GET') {
      const session = sessionId ? this.sessions.get(sessionId) : null

      if (!session) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Session not found or not initialized' },
          id: null
        })
        return
      }

      await session.transport.handleRequest(req, res)
    } else if (req.method === 'DELETE') {
      if (sessionId && this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)
        await session.transport.close()
        this.sessions.delete(sessionId)
        logger.info('MCP session terminated', {
          service: this.mcp.name,
          sessionId,
          requestId: req.requestId
        })
        res.status(200).end()
      } else {
        res.status(404).json({ error: 'Session not found' })
      }
    } else {
      res.status(405).json({ error: 'Method not allowed' })
    }
  }

  /**
   * Legacy SSE endpoint - deprecated
   */
  _handleLegacySse(req, res) {
    res.status(410).json({
      error: 'SSE transport deprecated',
      message: 'Please use Streamable HTTP transport at /mcp endpoint',
      spec: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports'
    })
  }

  /**
   * Start the server
   */
  start() {
    const authMode = this.oauth ? 'oauth' : 'token'
    this.httpServer = this.app.listen(this.port, () => {
      logger.info(`${this.mcp.name} (Streamable HTTP, ${authMode}) started`, {
        service: this.mcp.name,
        port: this.port,
        authMode,
        mcpEndpoint: `http://localhost:${this.port}/mcp`,
        healthEndpoint: `http://localhost:${this.port}/health`
      })
    })

    process.on('SIGTERM', () => this._shutdown())
    process.on('SIGINT', () => this._shutdown())
  }

  /**
   * Graceful shutdown
   */
  async _shutdown() {
    logger.info('Shutting down...', { service: this.mcp.name })

    // Close all MCP sessions
    for (const [sessionId, session] of this.sessions) {
      try {
        await session.server.close()
      } catch (err) {
        logger.error('Error closing session', { sessionId, error: err.message })
      }
    }

    // Flush and close tracing
    await flushTracing()
    await closeTracing()

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close()
    }

    process.exit(0)
  }
}
