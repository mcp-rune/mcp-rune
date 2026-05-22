/**
 * StartupTracker -- Phase-based startup logging
 *
 * Wraps each startup phase with clear boundary markers so failures
 * are dead-simple to isolate. Passes a scoped child logger into
 * each phase callback. Each phase is timed; the success line includes
 * its duration, the summary line includes the total.
 *
 * @example
 *   const startup = new StartupTracker(logger)
 *   const config = startup.phase('config', 'Load configuration', (log) => {
 *     const cfg = loadConfig(schema)
 *     log.debug(cfg.toString())
 *     return cfg
 *   })
 *   startup.skip('database', 'Database', 'DATABASE_URL not set')
 *   startup.done()
 */

import { performance } from 'node:perf_hooks'

import { hintForError } from './error-hints.js'

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
  child(meta: Record<string, unknown>): Logger
}

interface Phase {
  slug: string
  name: string
  status: 'ok' | 'skipped' | 'failed'
  durationMs?: number
}

const SERVICE = 'startup'

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
}

export class StartupTracker {
  #logger: Logger
  #phases: Phase[] = []
  #startedAt: number

  constructor(logger: Logger) {
    this.#logger = logger
    this.#startedAt = performance.now()
  }

  /**
   * Execute a synchronous startup phase with boundary markers.
   *
   * @throws Re-throws any error from fn after logging it
   */
  phase<T>(slug: string, name: string, fn: (log: Logger) => T): T {
    this.#logger.info(`▸ ${name}`, { service: SERVICE })

    const scopedLog = this.#logger.child({ service: `${SERVICE}:${slug}` })
    const t0 = performance.now()

    try {
      const result = fn(scopedLog)
      const durationMs = Math.round(performance.now() - t0)
      this.#phases.push({ slug, name, status: 'ok', durationMs })
      this.#logger.info(`✓ ${name} (${formatDuration(durationMs)})`, {
        service: SERVICE,
        durationMs
      })
      return result
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0)
      this.#phases.push({ slug, name, status: 'failed', durationMs })
      const error = err as Error & { code?: string; cause?: Error }
      const hint = hintForError(error)
      scopedLog.error(error.message, {
        errorType: error.constructor.name,
        code: error.code,
        stack: error.stack,
        durationMs,
        ...(hint && { hint }),
        ...(error.cause && {
          cause: error.cause.message,
          causeStack: error.cause.stack
        })
      })
      const suffix = hint ? ` — ${hint}` : ''
      this.#logger.error(`✗ ${name} — ${error.message}${suffix}`, { service: SERVICE })
      throw err
    }
  }

  /**
   * Record a skipped phase.
   */
  skip(slug: string, name: string, reason?: string): void {
    this.#phases.push({ slug, name, status: 'skipped' })
    const msg = reason ? `⊖ ${name} — ${reason}` : `⊖ ${name}`
    this.#logger.debug(msg, { service: SERVICE })
  }

  /**
   * Log startup summary with total duration. The per-phase ✓/⊖/✗
   * line was emitted as each phase finished, so no second listing is needed.
   */
  done(): void {
    const ok = this.#phases.filter((p) => p.status === 'ok').length
    const skipped = this.#phases.filter((p) => p.status === 'skipped').length
    const failed = this.#phases.filter((p) => p.status === 'failed').length
    const total = this.#phases.length
    const durationMs = Math.round(performance.now() - this.#startedAt)

    const parts = [`${ok} ok`]
    if (skipped > 0) parts.push(`${skipped} skipped`)
    if (failed > 0) parts.push(`${failed} failed`)

    this.#logger.info(
      `Startup complete: ${total} phases (${parts.join(', ')}) in ${formatDuration(durationMs)}`,
      { service: SERVICE, durationMs }
    )
  }
}
