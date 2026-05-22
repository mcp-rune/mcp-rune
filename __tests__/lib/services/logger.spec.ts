// Capture the printf formatter so individual tests can invoke it directly.
// winston.format is both a callable factory (`winston.format(fn)`) and an
// object with sub-formatters (combine, timestamp, printf, …). The real
// `winston.format(fn)` returns a function that, when called, returns the
// configured formatter — the mock mirrors that shape.
vi.mock('winston', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    defaultMeta: { app: 'mcp-servers' },
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }

  const formatFactory = vi.fn((fn) => {
    // Real winston.format(fn) returns a function that returns the formatter.
    return vi.fn(() => fn)
  })
  Object.assign(formatFactory, {
    combine: vi.fn((...args) => args),
    timestamp: vi.fn((opts) => ({ kind: 'timestamp', opts })),
    printf: vi.fn((fn) => fn),
    colorize: vi.fn(() => 'colorize'),
    json: vi.fn(() => 'json-format')
  })

  return {
    default: {
      createLogger: vi.fn(() => mockLogger),
      format: formatFactory,
      transports: {
        Console: vi.fn()
      }
    }
  }
})

vi.mock('winston-daily-rotate-file', () => ({
  default: vi.fn()
}))

const logger = await import('../../../src/services/logger.js')
const requestContext = await import('../../../src/services/request-context.js')
import winston from 'winston'

describe('lib/services/logger', () => {
  const mockWinstonLogger = winston.createLogger()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('log functions', () => {
    it('debug delegates to winston logger', () => {
      logger.debug('test message', { key: 'value' })
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith('test message', { key: 'value' })
    })

    it('info delegates to winston logger', () => {
      logger.info('info message', { service: 'test' })
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('info message', { service: 'test' })
    })

    it('warn delegates to winston logger', () => {
      logger.warn('warning')
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith('warning', {})
    })

    it('error delegates to winston logger', () => {
      logger.error('error occurred', { err: 'details' })
      expect(mockWinstonLogger.error).toHaveBeenCalledWith('error occurred', { err: 'details' })
    })

    it('defaults meta to empty object', () => {
      logger.info('no meta')
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('no meta', {})
    })
  })

  describe('setApp', () => {
    it('updates the app label in defaultMeta', () => {
      logger.setApp('my-mcp-server')
      expect(mockWinstonLogger.defaultMeta.app).toBe('my-mcp-server')
    })
  })

  describe('child', () => {
    it('creates child logger with default metadata', () => {
      const childLogger = logger.child({ service: 'oauth2' })

      expect(mockWinstonLogger.child).toHaveBeenCalledWith({ service: 'oauth2' })
      expect(typeof childLogger.info).toBe('function')
      expect(typeof childLogger.warn).toBe('function')
      expect(typeof childLogger.error).toBe('function')
      expect(typeof childLogger.debug).toBe('function')
    })

    it('defaults to empty metadata', () => {
      logger.child()
      expect(mockWinstonLogger.child).toHaveBeenCalledWith({})
    })
  })

  describe('default export', () => {
    it('exports winston logger instance', () => {
      expect(logger.default).toBeDefined()
    })
  })

  // Pull out the text formatter (the function passed to printf at module-load
  // time). Two text formatters get constructed — colored (console) and plain
  // (file). Either is fine for assertions on output structure.
  const getTextFormatter = () => {
    const printfFn = winston.format.printf as ReturnType<typeof vi.fn>
    return printfFn.mock.calls[0]?.[0]
  }

  describe('text format (logfmt)', () => {
    it('renders metadata as key=value pairs in text mode', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'Request completed',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'express',
        method: 'POST',
        path: '/mcp',
        statusCode: 200,
        duration: '576ms',
        app: 'engineer-mcp'
      })

      expect(result).toContain('INFO')
      expect(result).toContain('[express]')
      expect(result).toContain('Request completed')
      expect(result).toContain('method=POST')
      expect(result).toContain('path=/mcp')
      expect(result).toContain('statusCode=200')
      expect(result).toContain('duration=576ms')
      // app key should be omitted in text mode
      expect(result).not.toContain('app=')
    })

    it('quotes string values containing spaces', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'test',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'test',
        error: 'something went wrong'
      })

      expect(result).toContain('error="something went wrong"')
    })

    it('renders nested objects as JSON', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'test',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'test',
        capabilities: { sampling: true, roots: false }
      })

      expect(result).toContain('capabilities={"sampling":true,"roots":false}')
    })

    it('renders empty metadata without trailing space', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'No metadata',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'test',
        app: 'mcp-servers' // app is skipped, so metadata is effectively empty
      })

      // Plain text mode (no ANSI) — exact match.
      expect(result).toBe('2026-04-26 16:25:01.123 INFO  [test] No metadata')
    })

    it('omits durationMs from logfmt tail (already embedded in the message)', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: '✓ Load configuration (42ms)',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'startup',
        durationMs: 42
      })

      // The message keeps the human-readable (42ms); the field doesn't leak
      // into the logfmt tail and duplicate it. JSON output (winston.format.json)
      // serializes the full info object unchanged, so structured queries on
      // durationMs still work.
      expect(result).toBe('2026-04-26 16:25:01.123 INFO  [startup] ✓ Load configuration (42ms)')
      expect(result).not.toContain('durationMs=')
    })

    it('renders single inter-token space when service tag is absent', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      // Pre-fix bug: `${svc}${req} ${message}` left a dangling space when svc
      // was empty, producing `INFO   [Sentry]…` (three spaces). The array-join
      // composition skips empty parts so the line stays tidy.
      const result = formatter({
        level: 'info',
        message: '[Sentry] Initialized for engineer-mcp@4.3.3',
        timestamp: '2026-04-26 16:25:01.123'
      })

      expect(result).toBe(
        '2026-04-26 16:25:01.123 INFO  [Sentry] Initialized for engineer-mcp@4.3.3'
      )
      expect(result).not.toMatch(/INFO {3,}/)
    })
  })

  describe('TTY color helpers', () => {
    it('dim() wraps text in ANSI dim+reset only when colored=true', () => {
      expect(logger.dim('hello', true)).toBe('\x1b[2mhello\x1b[0m')
      expect(logger.dim('hello', false)).toBe('hello')
    })

    it('colorizePhaseSymbol() colors a leading ▸/✓/✗/⊖ marker', () => {
      expect(logger.colorizePhaseSymbol('▸ Load configuration', true)).toBe(
        '\x1b[36m▸\x1b[0m Load configuration'
      )
      expect(logger.colorizePhaseSymbol('✓ Load configuration (42ms)', true)).toBe(
        '\x1b[32m✓\x1b[0m Load configuration (42ms)'
      )
      expect(logger.colorizePhaseSymbol('✗ Database — boom', true)).toBe(
        '\x1b[31m✗\x1b[0m Database — boom'
      )
      expect(logger.colorizePhaseSymbol('⊖ Tracing — disabled', true)).toBe(
        '\x1b[2m⊖\x1b[0m Tracing — disabled'
      )
    })

    it('colorizePhaseSymbol() leaves messages without a phase marker untouched', () => {
      expect(logger.colorizePhaseSymbol('Plain message', true)).toBe('Plain message')
      expect(logger.colorizePhaseSymbol('', true)).toBe('')
    })

    it('colorizePhaseSymbol() is a no-op when colored=false', () => {
      expect(logger.colorizePhaseSymbol('✓ done', false)).toBe('✓ done')
    })
  })

  describe('text format — requestId prefix', () => {
    it('renders requestId as compact [req:<8-chars>] prefix and excludes from logfmt tail', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'Request started',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'express',
        requestId: 'a1b2c3d4-5678-4def-90ab-cdef12345678',
        method: 'POST'
      })

      expect(result).toContain('[req:a1b2c3d4]')
      // The 8-char head shouldn't bleed into logfmt as `requestId=…`
      expect(result).not.toContain('requestId=')
    })

    it('omits the requestId prefix when no requestId is present', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'Boot',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'startup'
      })

      expect(result).not.toContain('[req:')
    })
  })

  describe('text format — multi-line stack rendering', () => {
    it('appends stack on indented continuation lines below the message', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const stack = 'Error: boom\n    at foo (/tmp/x.js:1:1)\n    at bar (/tmp/x.js:2:2)'
      const result = formatter({
        level: 'error',
        message: 'boom',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'test',
        stack
      })

      const lines = result.split('\n')
      expect(lines[0]).toContain('boom')
      // Stack must not be inlined as a logfmt key
      expect(lines[0]).not.toContain('stack=')
      // Each stack frame appears on its own indented line
      expect(lines.length).toBeGreaterThanOrEqual(4)
      expect(lines[1]).toMatch(/^ {4}.*Error: boom/)
      expect(lines[2]).toMatch(/^ {4}.*foo \/tmp\/x.js:1:1/)
    })

    it('renders cause stack below the main stack with a "caused by:" separator', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'error',
        message: 'connection failed',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'db',
        stack: 'Error: connection failed\n    at db (/x.js:1:1)',
        causeStack: 'Error: socket hang up\n    at sock (/y.js:1:1)'
      })

      expect(result).toContain('caused by:')
      expect(result).toMatch(/connection failed[\s\S]*caused by:[\s\S]*socket hang up/)
    })

    it('renders without a stack block when no stack metadata is present', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const result = formatter({
        level: 'info',
        message: 'no error here',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'test'
      })

      expect(result).not.toContain('\n')
    })
  })

  describe('requestId injection from AsyncLocalStorage', () => {
    it('injects the current scope requestId when caller did not provide one', () => {
      // Pull out the injectRequestId formatter (the function passed to
      // winston.format() at module-load). winston.format(fn) is mocked to
      // return a factory that returns `fn`, so calling format.mock.results[i]
      // and invoking the returned factory yields the underlying transform.
      const formatFactory = winston.format as unknown as ReturnType<typeof vi.fn>
      const firstFactoryCall = formatFactory.mock.results[0]?.value
      const transform = firstFactoryCall?.()
      if (typeof transform !== 'function') return

      requestContext.runWithRequestId('test-id-from-als', () => {
        const out = transform({ level: 'info', message: 'inside scope' })
        expect(out.requestId).toBe('test-id-from-als')
      })
    })

    it('preserves an explicit requestId on the log entry over the ALS value', () => {
      const formatFactory = winston.format as unknown as ReturnType<typeof vi.fn>
      const firstFactoryCall = formatFactory.mock.results[0]?.value
      const transform = firstFactoryCall?.()
      if (typeof transform !== 'function') return

      requestContext.runWithRequestId('als-value', () => {
        const out = transform({ level: 'info', message: 'explicit wins', requestId: 'explicit' })
        expect(out.requestId).toBe('explicit')
      })
    })

    it('does not inject anything outside a request scope', () => {
      const formatFactory = winston.format as unknown as ReturnType<typeof vi.fn>
      const firstFactoryCall = formatFactory.mock.results[0]?.value
      const transform = firstFactoryCall?.()
      if (typeof transform !== 'function') return

      const out = transform({ level: 'info', message: 'no scope' })
      expect(out.requestId).toBeUndefined()
    })
  })

  // Regression coverage for the winston-daily-rotate-file retention bug.
  // Without a pinned `auditFile`, the library derives its ledger filename from
  // a hash that includes a per-process nonce, so every restart creates a fresh
  // audit and `maxFiles: '7d'` only reaps files the current instance wrote —
  // silently accumulating orphans from previous audits. These tests assert
  // that both DailyRotateFile transports are constructed with stable audit
  // paths so every process instance shares the same retention ledger.
  describe('file transport configuration (auditFile pinning)', () => {
    const reloadLogger = async (fileEnabled) => {
      const prev = process.env.LOG_FILE_ENABLED
      if (fileEnabled) process.env.LOG_FILE_ENABLED = 'true'
      else delete process.env.LOG_FILE_ENABLED
      try {
        vi.resetModules()
        await import('../../../src/services/logger.js')
        return (await import('winston-daily-rotate-file')).default
      } finally {
        if (prev === undefined) delete process.env.LOG_FILE_ENABLED
        else process.env.LOG_FILE_ENABLED = prev
      }
    }

    it('pins auditFile for combined and error transports when LOG_FILE_ENABLED=true', async () => {
      const DailyRotateFile = await reloadLogger(true)

      expect(DailyRotateFile).toHaveBeenCalledTimes(2)
      const optsList = DailyRotateFile.mock.calls.map(([opts]) => opts)

      const combined = optsList.find((o) => o.filename === 'logs/combined-%DATE%.log')
      expect(combined).toBeDefined()
      expect(combined.auditFile).toBe('logs/.combined-audit.json')
      expect(combined.maxFiles).toBe('7d')

      const errorTransport = optsList.find((o) => o.filename === 'logs/error-%DATE%.log')
      expect(errorTransport).toBeDefined()
      expect(errorTransport.auditFile).toBe('logs/.error-audit.json')
      expect(errorTransport.maxFiles).toBe('7d')
    })

    it('does not construct DailyRotateFile transports when LOG_FILE_ENABLED is unset', async () => {
      const DailyRotateFile = await reloadLogger(false)
      expect(DailyRotateFile).not.toHaveBeenCalled()
    })
  })
})
