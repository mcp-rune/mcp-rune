/**
 * StartupTracker -- Phase-based startup logging
 *
 * Wraps each startup phase with a single completion marker (✓/✗/⊖) so
 * the happy path is one line per phase. The phase name lives in the
 * completion message, so no separate start marker is needed in the
 * common case.
 *
 * For async phases (`phaseAsync`), if a phase runs longer than
 * DEFERRED_START_MS without settling, a deferred `▸ name` line is
 * emitted so a slow phase doesn't look like a hang. Sync phases never
 * emit `▸` — a sync block holds the event loop, so the deferred timer
 * could never fire before the phase returns anyway.
 *
 * Each phase callback receives a scoped child logger
 * (`service: startup:<slug>`) and the total duration is reported via
 * `done()`.
 *
 * @example
 *   const startup = new StartupTracker(logger)
 *   const config = startup.phase('config', 'Load configuration', (log) => {
 *     const cfg = loadConfig(schema)
 *     log.debug(cfg.toString())
 *     return cfg
 *   })
 *   await startup.phaseAsync('database', 'Database', async (log) => {
 *     await connect()
 *   })
 *   startup.skip('cache', 'Cache', 'CACHE_URL not set')
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
const DEFERRED_START_MS = 250

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
   * Execute a synchronous startup phase. Emits only the completion
   * marker (`✓ name (Xms)` on success, `✗ name — err` on failure).
   * Sync phases never get a deferred `▸` — the event loop is blocked
   * for the duration, so a setTimeout couldn't fire before the phase
   * returns.
   *
   * @throws Re-throws any error from fn after logging it
   */
  phase<T>(slug: string, name: string, fn: (log: Logger) => T): T {
    const scopedLog = this.#logger.child({ service: `${SERVICE}:${slug}` })
    const t0 = performance.now()

    try {
      const result = fn(scopedLog)
      this.#emitOk(slug, name, t0)
      return result
    } catch (err) {
      this.#emitFail(slug, name, t0, err, scopedLog)
      throw err
    }
  }

  /**
   * Execute an asynchronous startup phase. Same completion semantics
   * as `phase`, plus a deferred `▸ name` start line if the phase
   * hasn't settled after DEFERRED_START_MS (so a slow phase is
   * visible while in flight). The timer is `unref`'d so a hung phase
   * never holds the process open.
   */
  async phaseAsync<T>(slug: string, name: string, fn: (log: Logger) => Promise<T>): Promise<T> {
    const scopedLog = this.#logger.child({ service: `${SERVICE}:${slug}` })
    const t0 = performance.now()
    const startTimer = setTimeout(() => {
      this.#logger.info(`▸ ${name}`, { service: SERVICE })
    }, DEFERRED_START_MS)
    startTimer.unref()

    try {
      const result = await fn(scopedLog)
      clearTimeout(startTimer)
      this.#emitOk(slug, name, t0)
      return result
    } catch (err) {
      clearTimeout(startTimer)
      this.#emitFail(slug, name, t0, err, scopedLog)
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

  #emitOk(slug: string, name: string, t0: number): void {
    const durationMs = Math.round(performance.now() - t0)
    this.#phases.push({ slug, name, status: 'ok', durationMs })
    this.#logger.info(`✓ ${name} (${formatDuration(durationMs)})`, {
      service: SERVICE,
      durationMs
    })
  }

  #emitFail(slug: string, name: string, t0: number, err: unknown, scopedLog: Logger): void {
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
    this.#logger.error(`✗ ${name} — ${error.message}${suffix} (${formatDuration(durationMs)})`, {
      service: SERVICE,
      durationMs
    })
  }
}
