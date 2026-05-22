import { StartupTracker } from '#src/core/startup-tracker.js'

function createMockLogger() {
  const childInstance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }

  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => childInstance),
    _childInstance: childInstance
  }
}

describe('lib/core/startup-tracker', () => {
  let logger
  let tracker

  beforeEach(() => {
    logger = createMockLogger()
    tracker = new StartupTracker(logger)
  })

  describe('phase()', () => {
    it('logs start marker before callback executes', () => {
      let startLogged = false
      tracker.phase('config', 'Load configuration', () => {
        startLogged = logger.info.mock.calls.some(([msg]) =>
          msg.includes('\u25B8 Load configuration')
        )
      })
      expect(startLogged).toBe(true)
    })

    it('logs start marker with startup service tag', () => {
      tracker.phase('config', 'Load configuration', () => {})

      const startCall = logger.info.mock.calls.find(([msg]) =>
        msg.includes('\u25B8 Load configuration')
      )
      expect(startCall[1]).toEqual({ service: 'startup' })
    })

    it('creates child logger with service startup:<slug>', () => {
      tracker.phase('config', 'Load configuration', () => {})
      expect(logger.child).toHaveBeenCalledWith({ service: 'startup:config' })
    })

    it('passes scoped logger to callback', () => {
      let received = null
      tracker.phase('config', 'Load configuration', (log) => {
        received = log
      })
      expect(received).toBe(logger._childInstance)
    })

    it('logs success marker after callback with duration suffix', () => {
      tracker.phase('config', 'Load configuration', () => {})

      const successCall = logger.info.mock.calls.find(([msg]) =>
        msg.includes('\u2713 Load configuration')
      )
      expect(successCall).toBeDefined()
      // Success line carries the phase duration as a `(<N>ms)` or `(<N>s)` suffix.
      expect(successCall[0]).toMatch(/\u2713 Load configuration \((\d+ms|\d+\.\d+s)\)/)
      expect(successCall[1]).toEqual({ service: 'startup', durationMs: expect.any(Number) })
    })

    it('returns callback return value', () => {
      const result = tracker.phase('config', 'Load configuration', () => {
        return { apiUrl: 'http://localhost' }
      })
      expect(result).toEqual({ apiUrl: 'http://localhost' })
    })

    it('logs error with metadata on scoped logger when callback throws', () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:5432')
      err.code = 'ECONNREFUSED'
      try {
        tracker.phase('database', 'Database', () => {
          throw err
        })
      } catch {
        /* expected */
      }

      expect(logger._childInstance.error).toHaveBeenCalledWith(
        'connect ECONNREFUSED 127.0.0.1:5432',
        expect.objectContaining({
          errorType: 'Error',
          code: 'ECONNREFUSED',
          stack: expect.stringContaining('connect ECONNREFUSED'),
          durationMs: expect.any(Number)
        })
      )
    })

    it('appends a human-readable hint when err.code is a known POSIX code', () => {
      const err = new Error('listen EADDRINUSE :::4100')
      err.code = 'EADDRINUSE'
      try {
        tracker.phase('http', 'HTTP server', () => {
          throw err
        })
      } catch {
        /* expected */
      }

      const failCall = logger.error.mock.calls.find(([msg]) => msg.includes('✗ HTTP server'))
      expect(failCall[0]).toMatch(/EADDRINUSE.*another process is using that port/)

      // Scoped logger also gets the hint in metadata so structured queries can filter on it.
      const [, scopedMeta] = logger._childInstance.error.mock.calls[0]
      expect(scopedMeta.hint).toMatch(/another process is using that port/)
    })

    it('does not append a hint for errors without a known code', () => {
      const err = new Error('unmapped error')
      err.code = 'EWHATEVER'
      try {
        tracker.phase('thing', 'Thing', () => {
          throw err
        })
      } catch {
        /* expected */
      }

      const failCall = logger.error.mock.calls.find(([msg]) => msg.includes('✗ Thing'))
      // No trailing — hint clause.
      expect(failCall[0]).toBe('✗ Thing — unmapped error')
    })

    it('preserves custom error type in errorType metadata', () => {
      try {
        tracker.phase('config', 'Load configuration', () => {
          throw new TypeError('expected string, got number')
        })
      } catch {
        /* expected */
      }

      expect(logger._childInstance.error).toHaveBeenCalledWith(
        'expected string, got number',
        expect.objectContaining({ errorType: 'TypeError' })
      )
    })

    it('includes cause metadata when error has a cause', () => {
      const cause = new Error('socket hang up')
      const err = new Error('connection failed', { cause })
      try {
        tracker.phase('database', 'Database', () => {
          throw err
        })
      } catch {
        /* expected */
      }

      expect(logger._childInstance.error).toHaveBeenCalledWith(
        'connection failed',
        expect.objectContaining({
          errorType: 'Error',
          cause: 'socket hang up',
          causeStack: expect.stringContaining('socket hang up')
        })
      )
    })

    it('omits cause metadata when error has no cause', () => {
      try {
        tracker.phase('database', 'Database', () => {
          throw new Error('simple error')
        })
      } catch {
        /* expected */
      }

      const [, meta] = logger._childInstance.error.mock.calls[0]
      expect(meta).not.toHaveProperty('cause')
      expect(meta).not.toHaveProperty('causeStack')
    })

    it('logs failure marker when callback throws', () => {
      try {
        tracker.phase('database', 'Database', () => {
          throw new Error('connect ECONNREFUSED')
        })
      } catch {
        /* expected */
      }

      const failCall = logger.error.mock.calls.find(([msg]) => msg.includes('\u2717 Database'))
      expect(failCall).toBeDefined()
      expect(failCall[0]).toContain('connect ECONNREFUSED')
      expect(failCall[1]).toEqual({ service: 'startup' })
    })

    it('re-throws the original error', () => {
      const original = new Error('boom')
      expect(() => {
        tracker.phase('database', 'Database', () => {
          throw original
        })
      }).toThrow(original)
    })
  })

  describe('skip()', () => {
    it('logs at debug level with reason', () => {
      tracker.skip('database', 'Database', 'DATABASE_URL not set')

      expect(logger.debug).toHaveBeenCalledWith('\u2296 Database \u2014 DATABASE_URL not set', {
        service: 'startup'
      })
    })

    it('logs at debug level without reason', () => {
      tracker.skip('database', 'Database')

      expect(logger.debug).toHaveBeenCalledWith('\u2296 Database', { service: 'startup' })
    })
  })

  describe('done()', () => {
    // Each \u2713/\u2296/\u2717 already logged as phases finished, so done() emits one
    // summary line with counts and total duration \u2014 no redundant phase list.
    const matchSummary = (counts: string) =>
      new RegExp(`^Startup complete: \\d+ phases \\(${counts}\\) in (\\d+ms|\\d+\\.\\d+s)$`)

    it('logs summary with correct counts for ok phases', () => {
      tracker.phase('config', 'Load configuration', () => {})
      tracker.phase('tools', 'Register tools', () => {})
      tracker.done()

      const summaryCall = logger.info.mock.calls.find(([msg]) => msg.includes('Startup complete'))
      expect(summaryCall[0]).toMatch(matchSummary('2 ok'))
    })

    it('logs summary with ok and skipped counts', () => {
      tracker.phase('config', 'Load configuration', () => {})
      tracker.skip('database', 'Database', 'not configured')
      tracker.done()

      const summaryCall = logger.info.mock.calls.find(([msg]) => msg.includes('Startup complete'))
      expect(summaryCall[0]).toMatch(matchSummary('1 ok, 1 skipped'))
    })

    it('logs summary with ok, skipped, and failed counts', () => {
      tracker.phase('config', 'Load configuration', () => {})
      tracker.skip('tracing', 'Tracing', 'keys not set')
      try {
        tracker.phase('database', 'Database', () => {
          throw new Error('connection failed')
        })
      } catch {
        /* expected */
      }
      tracker.done()

      const summaryCall = logger.info.mock.calls.find(([msg]) => msg.includes('Startup complete'))
      expect(summaryCall[0]).toMatch(matchSummary('1 ok, 1 skipped, 1 failed'))
    })

    it('does not emit a per-phase debug listing (each \u2713/\u2296/\u2717 already appeared inline)', () => {
      tracker.phase('config', 'Load configuration', () => {})
      tracker.skip('tracing', 'Tracing', 'keys not set')
      try {
        tracker.phase('database', 'Database', () => {
          throw new Error('connection failed')
        })
      } catch {
        /* expected */
      }
      tracker.done()

      // No `  \u2713 \u2026` / `  \u2296 \u2026` / `  \u2717 \u2026` debug entries should be emitted.
      const indentedDebugCalls = logger.debug.mock.calls.filter(
        ([msg]) => typeof msg === 'string' && /^ {2}[\u2713\u2296\u2717]/.test(msg)
      )
      expect(indentedDebugCalls).toHaveLength(0)
    })

    it('logs summary with zero phases', () => {
      tracker.done()

      const summaryCall = logger.info.mock.calls.find(([msg]) => msg.includes('Startup complete'))
      expect(summaryCall[0]).toMatch(matchSummary('0 ok'))
    })

    it('logs summary with startup service tag and durationMs metadata', () => {
      tracker.done()

      const summaryCall = logger.info.mock.calls.find(([msg]) => msg.includes('Startup complete'))
      expect(summaryCall[1]).toEqual({ service: 'startup', durationMs: expect.any(Number) })
    })
  })
})
