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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Express, NextFunction, Request, Response } from 'express'
import express from 'express'

import { hintForError } from '#src/core/error-hints.js'
import type { OAuthService } from '#src/oauth2/service.js'
import {
  captureException,
  ErrorCategory,
  flushErrorTracking,
  isErrorTrackingEnabled
} from '#src/services/error-tracking.js'
import * as logger from '#src/services/logger.js'
import { closeTracing, flushTracing } from '#src/services/tracing.js'

import { createCorsMiddleware } from './middleware/cors.js'
import { createMcpAuthMiddleware } from './middleware/mcp-auth.js'
import { createMcpRequestHandler } from './middleware/mcp-handler.js'
import { createOAuthRouter } from './middleware/oauth-router.js'
import { createMcpRateLimitMiddleware } from './middleware/rate-limit.js'
import { createRequestIdMiddleware } from './middleware/request-id.js'
import { createRequestLoggerMiddleware } from './middleware/request-logger.js'
import { createSecurityHeadersMiddleware } from './middleware/security-headers.js'
import { createStatusRouter } from './middleware/status-router.js'
import { SessionManager } from './session-manager.js'

interface McpConfig {
  name: string
  createServer: (options: {
    sessionId: string
    transport: string
    getAccessToken: () => Promise<string | null | undefined>
  }) => McpServer
  promptRegistry?: PromptRegistryWithStats
}

interface PromptRegistryWithStats {
  getStats?: () => Record<string, unknown>
}

interface HttpServerConfig {
  port: number
  baseUrl?: string
  pathPrefix?: string
  oauth?: OAuthService
  accessToken?: string
  mcp: McpConfig
  isProduction?: boolean
  corsOrigins?: string
}

/** Extended request with requestId from request-id middleware. */
interface McpRequest extends Request {
  requestId?: string
}

export class HttpServer {
  private port: number
  private oauth: OAuthService | null
  private accessToken: string | null
  private mcp: McpConfig
  private pathPrefix: string
  private baseUrl: string
  sessions: SessionManager
  private _isProduction: boolean
  private _isDevelopment: boolean
  private _corsOrigins: string | undefined
  app: Express
  private httpServer: ReturnType<Express['listen']> | null

  constructor({
    port,
    baseUrl,
    pathPrefix,
    oauth,
    accessToken,
    mcp,
    isProduction,
    corsOrigins
  }: HttpServerConfig) {
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
    // In production, this should be the public URL (e.g., 'https://example.com/mcp')
    this.baseUrl = baseUrl || `http://localhost:${this.port}`

    // RFC 8707 single source of truth: the OAuth router will inject this same
    // `${baseUrl}/mcp` on authorize/token redirects, and OAuthService validates
    // it as the audience on introspection. Previously the OAuth router had its
    // own fallback while OAuthService.resourceUri stayed null when the caller
    // omitted it — which silently skipped the audience check in
    // OAuthService.introspectToken. Inject here so the two halves cannot drift.
    if (this.oauth) {
      this.oauth.applyDefaultResourceUri(`${this.baseUrl}/mcp`)
    }

    // Session storage: sessionId -> { transport, server, accessToken }
    this.sessions = new SessionManager()

    // Environment flags -- injected, no process.env reads
    this._isProduction = isProduction ?? false
    this._isDevelopment = !this._isProduction
    this._corsOrigins = corsOrigins

    // Express app
    this.app = express()
    this.httpServer = null

    this._setupMiddleware()
    this._registerRoutes()
  }

  /** Setup Express middleware */
  private _setupMiddleware(): void {
    this.app.use(createSecurityHeadersMiddleware({ isProduction: this._isProduction }))

    this.app.use(
      createCorsMiddleware({
        corsOrigins: this._corsOrigins,
        isProduction: this._isProduction,
        serviceName: this.mcp.name
      })
    )

    this.app.use(`${this.pathPrefix}/mcp`, createMcpRateLimitMiddleware())

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

  /** Wrap async route handlers to catch errors and forward to error middleware */
  private _asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => unknown
  ): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next)
    }
  }

  /** Register all HTTP routes */
  private _registerRoutes(): void {
    const prefix = this.pathPrefix

    // OAuth routes (well-known endpoints, token, register, etc.) -- OAuth mode only.
    //
    // When mounted under a non-empty pathPrefix, the framework cannot serve the
    // RFC 9728 Protected Resource Metadata endpoints itself: `.well-known` URIs
    // are origin-scoped (RFC 9728 §3.1), so they must live at the origin root
    // and be served by the upstream reverse proxy. The WWW-Authenticate header
    // still advertises the correct origin-rooted URL.
    if (this.oauth) {
      const oauthRouter = createOAuthRouter({
        oauth: this.oauth,
        baseUrl: this.baseUrl,
        mcpName: this.mcp.name,
        serveProtectedResourceMetadata: this.pathPrefix === ''
      })
      this.app.use(prefix, oauthRouter)
    }

    // Health + cache-stats endpoints
    this.app.use(
      prefix,
      createStatusRouter({
        serviceName: this.mcp.name,
        getActiveSessions: () => this.sessions.size,
        promptRegistry: this.mcp.promptRegistry
      })
    )

    // MCP transport endpoint — auth runs as a route-scoped middleware so it
    // does not affect oauth-router / health / cache-stats.
    const mcpAuth = createMcpAuthMiddleware({
      oauth: this.oauth,
      accessToken: this.accessToken,
      baseUrl: this.baseUrl,
      serviceName: this.mcp.name
    })
    const mcpHandler = createMcpRequestHandler({
      sessionManager: this.sessions,
      serviceName: this.mcp.name,
      isOAuthMode: this.oauth !== null,
      staticAccessToken: this.accessToken,
      createMcpServer: this.mcp.createServer
    })
    this.app.all(`${prefix}/mcp`, mcpAuth, this._asyncHandler(mcpHandler))

    // Also handle MCP requests at the base path (for Claude Desktop compatibility)
    // Claude Desktop expects MCP endpoint at the base URL, not /mcp subpath
    if (prefix) {
      this.app.all(prefix, mcpAuth, this._asyncHandler(mcpHandler))
    }

    // Legacy SSE endpoint - deprecated
    this.app.get(`${prefix}/sse`, this._handleLegacySse.bind(this))

    // Error handling middleware (must be registered last)
    this.app.use((err: Error, req: McpRequest, res: Response, _next: NextFunction) => {
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
        message: this._isDevelopment ? err.message : undefined
      })
    })
  }

  /** Legacy SSE endpoint - deprecated */
  private _handleLegacySse(_req: Request, res: Response): void {
    res.status(410).json({
      error: 'SSE transport deprecated',
      message: 'Please use Streamable HTTP transport at /mcp endpoint',
      spec: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports'
    })
  }

  /** Start the server */
  start(): void {
    const authMode = this.oauth ? 'oauth' : 'token'

    // Don't pass a success callback to app.listen. Express wraps it with
    // `once(callback)` and registers it as `once('error', done)`, which means a
    // bind failure invokes the callback with an error argument — silently
    // mis-firing our "started" log path. Subscribing to 'listening' / 'error'
    // explicitly keeps the two outcomes cleanly separated.
    this.httpServer = this.app.listen(this.port)

    this.httpServer.on('listening', () => {
      logger.info(`${this.mcp.name} (Streamable HTTP, ${authMode}) started`, {
        service: this.mcp.name,
        port: this.port,
        authMode,
        mcpEndpoint: `http://localhost:${this.port}/mcp`,
        healthEndpoint: `http://localhost:${this.port}/health`
      })
    })

    // Without this handler, a bind failure (EADDRINUSE, EACCES, …) raises
    // an unhandled 'error' event on the net.Server and Node exits the process
    // silently — no log line, no Sentry report. That makes a port-conflicted
    // prod container indistinguishable from "never started" in Loki/Grafana.
    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      void this._handleListenError(err)
    })

    process.on('SIGTERM', () => {
      void this._shutdown()
    })
    process.on('SIGINT', () => {
      void this._shutdown()
    })
  }

  private async _handleListenError(err: NodeJS.ErrnoException): Promise<void> {
    const hint = hintForError(err)
    const suffix = hint ? ` — ${hint}` : ''
    logger.error(`HTTP server failed to bind on port ${this.port}: ${err.message}${suffix}`, {
      service: this.mcp.name,
      port: this.port,
      code: err.code,
      syscall: err.syscall,
      stack: err.stack,
      ...(hint && { hint })
    })

    if (isErrorTrackingEnabled()) {
      captureException(err, {
        tags: {
          'error.category': ErrorCategory.INTERNAL,
          'startup.phase': 'http_listen',
          'error.code': err.code ?? 'unknown'
        },
        extra: {
          port: this.port,
          service: this.mcp.name,
          syscall: err.syscall
        },
        level: 'fatal'
      })
      // Bounded wait so a wedged Sentry transport can't hang a prod restart loop.
      await flushErrorTracking(2000).catch(() => false)
    }

    process.exit(1)
  }

  /** Graceful shutdown */
  private async _shutdown(): Promise<void> {
    logger.info('Shutting down...', { service: this.mcp.name })

    // Close all MCP sessions
    await this.sessions.closeAll()

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
