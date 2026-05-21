/**
 * MCP Rate-Limit Middleware
 *
 * 100 requests per 15-minute sliding window on the MCP endpoint. The key
 * generator hashes the Bearer token (SHA-256, first 16 hex chars) so that
 * each authenticated caller is rate-limited independently — without that,
 * a single misbehaving client could starve everyone behind the same NAT.
 * Anonymous callers fall back to IP-based limiting.
 *
 * The error body is shaped as a JSON-RPC error so MCP clients can surface
 * it through their normal error path instead of choking on an unexpected
 * payload.
 */

import { createHash } from 'node:crypto'

import type { Request } from 'express'
import type { RateLimitRequestHandler } from 'express-rate-limit'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

export function createMcpRateLimitMiddleware(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Too many requests, please try again later' },
      id: null
    },
    keyGenerator: (req: Request) => {
      const token = req.headers['authorization']?.slice(7)
      if (token) {
        const hash = createHash('sha256').update(token).digest('hex').slice(0, 16)
        return `token:${hash}`
      }
      return ipKeyGenerator(req.ip!)
    }
  })
}
