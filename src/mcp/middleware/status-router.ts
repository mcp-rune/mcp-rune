/**
 * Status Router — /health and /cache-stats.
 *
 * Mounted by HttpServer at the configured pathPrefix. The router owns no
 * state of its own — session count is read through a closure so the
 * SessionManager remains the single source of truth.
 *
 * `/cache-stats` is only registered when the prompt registry exposes
 * `getStats`. If it doesn't, the endpoint simply doesn't exist (rather
 * than returning a confusing 404 when called).
 */

import type { Request, Response } from 'express'
import { Router } from 'express'

export interface PromptRegistryWithStats {
  getStats?: () => Record<string, unknown>
}

export interface StatusRouterConfig {
  serviceName: string
  /** Live read so /health reflects current state without holding a reference to the map. */
  getActiveSessions: () => number
  promptRegistry?: PromptRegistryWithStats
}

export function createStatusRouter({
  serviceName,
  getActiveSessions,
  promptRegistry
}: StatusRouterConfig): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response) => {
    const health: Record<string, unknown> = {
      status: 'ok',
      service: serviceName,
      transport: 'streamable-http',
      activeSessions: getActiveSessions()
    }
    if (promptRegistry?.getStats) {
      health.promptCache = promptRegistry.getStats()
    }
    res.json(health)
  })

  if (promptRegistry?.getStats) {
    router.get('/cache-stats', (_req: Request, res: Response) => {
      res.json({
        service: serviceName,
        cache: promptRegistry.getStats!()
      })
    })
  }

  return router
}
