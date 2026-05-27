/**
 * CIMD (Client ID Metadata Document) extension.
 *
 * Serves `GET /oauth/client-metadata.json` so the MCP server can be used as a
 * CIMD `client_id` by upstream authorization servers — eliminating the need
 * for DCR or pre-registration in test environments.
 *
 * Built-in canonical registration key: `cimd`.
 *
 * This is a **server-hosted** CIMD: the MCP server identifies itself, not
 * the downstream MCP client. The MCP Authorization spec's model has the
 * downstream MCP client host its own document. Use this extension as a
 * convenience for testing CIMD end-to-end against authorization servers,
 * or as a stable fallback for downstream MCP clients (e.g. Opencode) that
 * do not host their own document.
 *
 * Usage:
 * ```ts
 * import { HttpServer } from '@mcp-rune/mcp-rune/server'
 * import { cimdExtension } from '@mcp-rune/mcp-rune/extensions/cimd'
 *
 * new HttpServer({
 *   oauth: new OAuthService({...}),
 *   mcp: {...},
 *   extensions: {
 *     cimd: cimdExtension({ redirectUris: ['https://app.example.com/cb'] })
 *   }
 * })
 * ```
 */

import { createHash } from 'node:crypto'

import type { Request, Response } from 'express'

import type { HttpExtension } from '#src/mcp/extensions/types.js'

/**
 * Configuration for the CIMD extension.
 *
 * `redirectUris` and `scope` are intentionally distinct from OAuthService's
 * `redirectUri` (the single callback the OAuth flow actually uses) and
 * `scopes` (what the server requests at auth time). They describe the full
 * surface advertised to the authorization server, which can be broader than
 * what any single flow uses. When omitted, the extension falls back to
 * `${baseUrl}/oauth/callback` and `oauth.scopes`.
 */
export interface CimdOptions {
  /** Callback URLs to advertise. Defaults to `[${baseUrl}/oauth/callback]`. */
  redirectUris?: string[]
  /** Human-readable name. Defaults to the MCP server name. */
  clientName?: string
  /** Advertised scope string. Defaults to `oauth.scopes`. */
  scope?: string
  /** RFC 9111 `Cache-Control: max-age` in seconds. Defaults to 3600. */
  cacheMaxAge?: number
}

export function cimdExtension(options: CimdOptions = {}): HttpExtension {
  return {
    requires: ['oauth'],
    register(ctx) {
      const { router, baseUrl, mcpName, oauth, logger } = ctx
      // `requires: ['oauth']` guarantees this is non-null at boot.
      if (!oauth) {
        throw new Error('cimdExtension: oauth is required (declared via requires)')
      }

      router.get('/oauth/client-metadata.json', (_req: Request, res: Response) => {
        const metadataUrl = `${baseUrl}/oauth/client-metadata.json`

        logger.info('CIMD metadata document requested', {
          service: mcpName,
          clientId: metadataUrl
        })

        const body = {
          client_id: metadataUrl,
          client_name: options.clientName || mcpName,
          redirect_uris: options.redirectUris || [`${baseUrl}/oauth/callback`],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: options.scope || oauth.scopes
        }

        // RFC 9111: Cache headers so authorization servers know when to re-fetch.
        // IETF Client ID Metadata Document draft: servers SHOULD respect these.
        const maxAge = options.cacheMaxAge ?? 3600
        const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}"`

        res.setHeader('Cache-Control', `public, max-age=${maxAge}`)
        res.setHeader('ETag', etag)
        res.json(body)
      })
    }
  }
}
