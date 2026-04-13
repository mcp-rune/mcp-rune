/**
 * StartupTracker — Phase-based startup logging
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

const SERVICE = 'startup'

export class StartupTracker {
  #logger
  #phases = []

  /**
   * @param {Object} logger - Logger with info/warn/error/debug/child methods
   */
  constructor(logger) {
    this.#logger = logger
  }

  /**
   * Execute a synchronous startup phase with boundary markers.
   *
   * @param {string} slug - Short identifier (e.g. 'config', 'database')
   * @param {string} name - Human-readable name for log messages
   * @param {Function} fn - Phase callback, receives a scoped child logger
   * @returns {*} Return value of fn
   * @throws Re-throws any error from fn after logging it
   */
  phase(slug, name, fn) {
    this.#logger.info(`\u25B8 ${name}`, { service: SERVICE })

    const scopedLog = this.#logger.child({ service: `${SERVICE}:${slug}` })

    try {
      const result = fn(scopedLog)
      this.#phases.push({ slug, name, status: 'ok' })
      this.#logger.info(`\u2713 ${name}`, { service: SERVICE })
      return result
    } catch (err) {
      this.#phases.push({ slug, name, status: 'failed' })
      scopedLog.error(err.message, {
        errorType: err.constructor.name,
        code: err.code,
        stack: err.stack,
        ...(err.cause && {
          cause: err.cause.message,
          causeStack: err.cause.stack
        })
      })
      this.#logger.error(`\u2717 ${name} \u2014 ${err.message}`, { service: SERVICE })
      throw err
    }
  }

  /**
   * Record a skipped phase.
   *
   * @param {string} slug - Short identifier
   * @param {string} name - Human-readable name
   * @param {string} [reason] - Why the phase was skipped
   */
  skip(slug, name, reason) {
    this.#phases.push({ slug, name, status: 'skipped' })
    const msg = reason ? `\u2296 ${name} \u2014 ${reason}` : `\u2296 ${name}`
    this.#logger.debug(msg, { service: SERVICE })
  }

  /**
   * Log startup summary.
   */
  done() {
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

    const statusMarkers = { ok: '\u2713', skipped: '\u2296', failed: '\u2717' }
    for (const p of this.#phases) {
      this.#logger.debug(`  ${statusMarkers[p.status]} ${p.name}`, { service: SERVICE })
    }
  }
}
