/**
 * SessionManager — owns the in-memory map of MCP sessions.
 *
 * Each session pairs a Streamable HTTP transport with the McpServer that was
 * connected to it. The access token is mutable so that OAuth-mode token
 * refreshes are picked up by the next tool invocation without tearing the
 * session down.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import * as logger from '#src/services/logger.js'

export interface SessionEntry {
  transport: StreamableHTTPServerTransport
  server: McpServer | null
  accessToken: string | null | undefined
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionEntry>()

  get size(): number {
    return this.sessions.size
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  set(sessionId: string, entry: SessionEntry): void {
    this.sessions.set(sessionId, entry)
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Iterate all sessions, used by graceful shutdown. */
  entries(): IterableIterator<[string, SessionEntry]> {
    return this.sessions.entries()
  }

  /**
   * Close every active session's McpServer. Errors are logged but never
   * thrown — shutdown must continue even if one session's close hangs/fails.
   */
  async closeAll(): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      try {
        await session.server?.close()
      } catch (err) {
        const error = err as Error
        logger.error('Error closing session', { sessionId, error: error.message })
      }
    }
  }
}
