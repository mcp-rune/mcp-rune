/**
 * StartupTracker -- Phase-based startup logging
 *
 * Wraps each startup phase with clear boundary markers so failures
 * are dead-simple to isolate. Passes a scoped child logger into
 * each phase callback.
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
}

const SERVICE = 'startup'

export class StartupTracker {
  #logger: Logger
  #phases: Phase[] = []

  constructor(logger: Logger) {
    this.#logger = logger
  }

  /**
   * Execute a synchronous startup phase with boundary markers.
   *
   * @throws Re-throws any error from fn after logging it
   */
  phase<T>(slug: string, name: string, fn: (log: Logger) => T): T {
    this.#logger.info(`\u25B8 ${name}`, { service: SERVICE })

    const scopedLog = this.#logger.child({ service: `${SERVICE}:${slug}` })

    try {
      const result = fn(scopedLog)
      this.#phases.push({ slug, name, status: 'ok' })
      this.#logger.info(`\u2713 ${name}`, { service: SERVICE })
      return result
    } catch (err) {
      this.#phases.push({ slug, name, status: 'failed' })
      const error = err as Error & { code?: string; cause?: Error }
      scopedLog.error(error.message, {
        errorType: error.constructor.name,
        code: error.code,
        stack: error.stack,
        ...(error.cause && {
          cause: error.cause.message,
          causeStack: error.cause.stack
        })
      })
      this.#logger.error(`\u2717 ${name} \u2014 ${error.message}`, { service: SERVICE })
      throw err
    }
  }

  /**
   * Record a skipped phase.
   */
  skip(slug: string, name: string, reason?: string): void {
    this.#phases.push({ slug, name, status: 'skipped' })
    const msg = reason ? `\u2296 ${name} \u2014 ${reason}` : `\u2296 ${name}`
    this.#logger.debug(msg, { service: SERVICE })
  }

  /**
   * Log startup summary.
   */
  done(): void {
    const ok = this.#phases.filter((p) => p.status === 'ok').length
    const skipped = this.#phases.filter((p) => p.status === 'skipped').length
    const failed = this.#phases.filter((p) => p.status === 'failed').length
    const total = this.#phases.length

    const parts = [`${ok} ok`]
    if (skipped > 0) parts.push(`${skipped} skipped`)
    if (failed > 0) parts.push(`${failed} failed`)

    this.#logger.info(`Startup complete: ${total} phases (${parts.join(', ')})`, {
      service: SERVICE
    })

    const statusMarkers: Record<Phase['status'], string> = {
      ok: '\u2713',
      skipped: '\u2296',
      failed: '\u2717'
    }
    for (const p of this.#phases) {
      this.#logger.debug(`  ${statusMarkers[p.status]} ${p.name}`, { service: SERVICE })
    }
  }
}
