/**
 * MCP Streamable HTTP Transport Handler
 *
 * Dispatches POST/GET/DELETE on the MCP endpoint. Assumes auth has already
 * been resolved by `createMcpAuthMiddleware` — reads the token off
 * `req.requestAccessToken` instead of re-deriving it.
 *
 * Session lifecycle:
 * - POST without a session id → create a new transport, let it generate a
 *   session id, wire up an McpServer in `onsessioninitialized`, and store
 *   the session.
 * - POST with a known session id → reuse its transport. In OAuth mode, if
 *   the request's resolved token differs from the session's stored token
 *   (i.e. the client refreshed), update the session in place so subsequent
 *   downstream calls see the fresh token.
 * - GET → resume the SSE stream for an existing session, or 400.
 * - DELETE → terminate a session, or 404.
 */

import { randomUUID } from 'node:crypto'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, RequestHandler, Response } from 'express'

import * as logger from '#src/runtime/logger.js'

import type { SessionEntry, SessionManager } from '../session-manager.js'
import type { AuthenticatedMcpRequest } from './mcp-auth.js'

export interface McpHandlerConfig {
  sessionManager: SessionManager
  /** Service name used in structured log entries. */
  serviceName: string
  /** True when oauth was provided to the http server. Controls token-refresh detection. */
  isOAuthMode: boolean
  /** Static token used by token-mode `getAccessToken`. Ignored in OAuth mode. */
  staticAccessToken: string | null
  createMcpServer: (options: {
    sessionId: string
    transport: string
    getAccessToken: () => Promise<string>
  }) => McpServer
}

export function createMcpRequestHandler(config: McpHandlerConfig): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    // Disable socket timeout for long-lived SSE connections.
    req.socket.setTimeout(0)

    const authReq = req as AuthenticatedMcpRequest
    const requestAccessToken = authReq.requestAccessToken
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (req.method === 'POST') {
      await handlePost(req, res, authReq, sessionId, requestAccessToken, config)
    } else if (req.method === 'GET') {
      await handleGet(req, res, sessionId, config)
    } else if (req.method === 'DELETE') {
      await handleDelete(authReq, res, sessionId, config)
    } else {
      res.status(405).json({ error: 'Method not allowed' })
    }
  }
}

async function handlePost(
  req: Request,
  res: Response,
  authReq: AuthenticatedMcpRequest,
  sessionId: string | undefined,
  requestAccessToken: string | null | undefined,
  { sessionManager, serviceName, isOAuthMode, staticAccessToken, createMcpServer }: McpHandlerConfig
): Promise<void> {
  const mcpMethod = (req.body as Record<string, unknown> | undefined)?.method
  if (mcpMethod) {
    logger.info('MCP request', {
      service: serviceName,
      method: mcpMethod,
      sessionId: sessionId || 'new',
      requestId: authReq.requestId
    })
  }

  const session = sessionId ? sessionManager.get(sessionId) : undefined

  if (session) {
    if (isOAuthMode && requestAccessToken !== session.accessToken) {
      session.accessToken = requestAccessToken
      logger.debug('Session access token updated', {
        service: serviceName,
        sessionId,
        requestId: authReq.requestId
      })
    }
    await session.transport.handleRequest(req, res, req.body)
    return
  }

  const currentRequestId = authReq.requestId
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: async (newSessionId: string) => {
      const sessionEntry: SessionEntry = {
        transport,
        server: null,
        accessToken: requestAccessToken
      }

      // OAuth mode: read live from the session map so token refreshes are picked up.
      // Token mode: always return the static token.
      // Both modes throw a typed runtime error rather than handing back null —
      // tools downstream can assume `Promise<string>`, matching the public contract.
      const getAccessToken: () => Promise<string> = isOAuthMode
        ? async () => {
            const token = sessionManager.get(newSessionId)?.accessToken
            if (!token) {
              throw new Error(
                'Session is not authenticated. The bearer token is missing or has been revoked.'
              )
            }
            return token
          }
        : async () => {
            if (!staticAccessToken) {
              throw new Error(
                'HttpServer is in token mode but no static access token is configured.'
              )
            }
            return staticAccessToken
          }

      const mcpServer = createMcpServer({
        sessionId: newSessionId,
        transport: 'streamable-http',
        getAccessToken
      })
      await mcpServer.connect(transport)

      sessionEntry.server = mcpServer
      sessionManager.set(newSessionId, sessionEntry)

      logger.info('New MCP session created', {
        service: serviceName,
        sessionId: newSessionId,
        requestId: currentRequestId
      })
    }
  })

  transport.onclose = () => {
    const sid = transport.sessionId
    if (sid) {
      logger.info('MCP session closed', { service: serviceName, sessionId: sid })
      sessionManager.delete(sid)
    }
  }

  await transport.handleRequest(req, res, req.body)
}

async function handleGet(
  req: Request,
  res: Response,
  sessionId: string | undefined,
  { sessionManager }: McpHandlerConfig
): Promise<void> {
  const session = sessionId ? sessionManager.get(sessionId) : undefined

  if (!session) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: Session not found or not initialized' },
      id: null
    })
    return
  }

  await session.transport.handleRequest(req, res)
}

async function handleDelete(
  authReq: AuthenticatedMcpRequest,
  res: Response,
  sessionId: string | undefined,
  { sessionManager, serviceName }: McpHandlerConfig
): Promise<void> {
  if (sessionId && sessionManager.has(sessionId)) {
    const session = sessionManager.get(sessionId)!
    await session.transport.close()
    sessionManager.delete(sessionId)
    logger.info('MCP session terminated', {
      service: serviceName,
      sessionId,
      requestId: authReq.requestId
    })
    res.status(200).end()
  } else {
    res.status(404).json({ error: 'Session not found' })
  }
}
