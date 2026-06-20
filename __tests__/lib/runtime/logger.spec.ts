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
    level: 'info',
    clear: vi.fn(),
    add: vi.fn(),
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

const logger = await import('../../../src/runtime/logger.js')
const requestContext = await import('../../../src/runtime/request-context.js')
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

      // info-level lines no longer emit a `INFO` word (Astro-style: only
      // warn/error carry a visible badge). Color does the level signaling.
      expect(result).not.toContain('INFO')
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

      // Plain text mode (no ANSI) — exact match. No `INFO` word on info lines.
      expect(result).toBe('2026-04-26 16:25:01.123 [test] No metadata')
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
      expect(result).toBe('2026-04-26 16:25:01.123 [startup] ✓ Load configuration (42ms)')
      expect(result).not.toContain('durationMs=')
    })

    it('renders single inter-token space when service tag is absent', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      // The array-join composition skips empty parts so the line stays tidy
      // even when service / requestId / level are all absent.
      const result = formatter({
        level: 'info',
        message: '[Sentry] Initialized for engineer-mcp@4.3.3',
        timestamp: '2026-04-26 16:25:01.123'
      })

      expect(result).toBe('2026-04-26 16:25:01.123 [Sentry] Initialized for engineer-mcp@4.3.3')
      expect(result).not.toMatch(/ {2,}\[Sentry]/)
    })

    it('emits WARN badge only for warn-level lines', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const warnLine = formatter({
        level: 'warn',
        message: 'cache miss',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'cache'
      })
      expect(warnLine).toBe('2026-04-26 16:25:01.123 WARN [cache] cache miss')
    })

    it('emits ERROR badge only for error-level lines', () => {
      const formatter = getTextFormatter()
      if (!formatter) return

      const errLine = formatter({
        level: 'error',
        message: 'boom',
        timestamp: '2026-04-26 16:25:01.123',
        service: 'db'
      })
      expect(errLine).toBe('2026-04-26 16:25:01.123 ERROR [db] boom')
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

    it('formatService() wraps the tag in brackets and colors known services', () => {
      // Known services use the curated color map (deterministic).
      expect(logger.formatService('express', true)).toBe('\x1b[32m[express]\x1b[0m')
      expect(logger.formatService('startup', true)).toBe('\x1b[36m[startup]\x1b[0m')
      // colored=false strips ANSI but still wraps in brackets.
      expect(logger.formatService('express', false)).toBe('[express]')
    })

    it('formatService() shares the parent color for scoped services like startup:db', () => {
      const parent = logger.formatService('startup', true)
      const scoped = logger.formatService('startup:db', true)
      // Same leading ANSI color, just a different tag body.
      expect(parent.slice(0, 5)).toBe(scoped.slice(0, 5))
      expect(scoped).toContain('[startup:db]')
    })

    it('formatService() falls back to a stable palette color for unknown services', () => {
      const a1 = logger.formatService('random-service-xyz', true)
      const a2 = logger.formatService('random-service-xyz', true)
      expect(a1).toBe(a2) // deterministic across calls
      expect(a1).toContain('[random-service-xyz]')
      // Wrapped in some ANSI color escape from the palette.
      // eslint-disable-next-line no-control-regex
      expect(a1).toMatch(/^\x1b\[\d+m\[random-service-xyz]\x1b\[0m$/)
    })

    it('colorizeStatusBadge() colors a [NNN] badge after a leading ←/→/✗ symbol', () => {
      expect(logger.colorizeStatusBadge('← [200] GET /health 2ms', true)).toBe(
        '← \x1b[32m[200]\x1b[0m GET /health 2ms'
      )
      expect(logger.colorizeStatusBadge('→ [302] GET /r 5ms', true)).toBe(
        '→ \x1b[36m[302]\x1b[0m GET /r 5ms'
      )
      expect(logger.colorizeStatusBadge('← [404] GET /missing 5ms', true)).toBe(
        '← \x1b[33m[404]\x1b[0m GET /missing 5ms'
      )
      expect(logger.colorizeStatusBadge('← [503] GET / 12ms', true)).toBe(
        '← \x1b[31m[503]\x1b[0m GET / 12ms'
      )
    })

    it('colorizeStatusBadge() dims an [ERR] badge (no HTTP response)', () => {
      expect(logger.colorizeStatusBadge('✗ [ERR] POST /x — Network down 5ms', true)).toBe(
        '✗ \x1b[2m[ERR]\x1b[0m POST /x — Network down 5ms'
      )
    })

    it('colorizeStatusBadge() leaves messages without the prefix pattern untouched', () => {
      expect(logger.colorizeStatusBadge('Plain message [200]', true)).toBe('Plain message [200]')
      expect(logger.colorizeStatusBadge('▸ GET /test', true)).toBe('▸ GET /test')
    })

    it('colorizeStatusBadge() is a no-op when colored=false', () => {
      expect(logger.colorizeStatusBadge('← [200] GET / 2ms', false)).toBe('← [200] GET / 2ms')
    })
  })

  describe('printBanner', () => {
    it('writes a multi-line Astro-style block to stderr', () => {
      const writes: string[] = []
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
        writes.push(String(chunk))
        return true
      })

      logger.printBanner({
        name: 'mcp-rune',
        version: '0.41.1',
        readyMs: 124,
        rows: [
          ['MCP', 'http://localhost:3000/mcp'],
          ['Health', 'http://localhost:3000/health']
        ]
      })

      spy.mockRestore()

      const out = writes.join('')
      expect(out).toContain('mcp-rune')
      expect(out).toContain('v0.41.1')
      expect(out).toContain('ready in 124 ms')
      expect(out).toContain('┃')
      expect(out).toContain('MCP')
      expect(out).toContain('http://localhost:3000/mcp')
    })

    it('omits the version segment when no version is provided', () => {
      const writes: string[] = []
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
        writes.push(String(chunk))
        return true
      })

      logger.printBanner({ name: 'mcp-rune', readyMs: 42, rows: [] })
      spy.mockRestore()

      const out = writes.join('')
      expect(out).toContain('mcp-rune')
      expect(out).not.toMatch(/v\d/)
      expect(out).toContain('ready in 42 ms')
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
        await import('../../../src/runtime/logger.js')
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

  // configureLogging() lets a schema-driven consumer override the env-derived
  // bootstrap with validated, injected config. The injected options are the
  // single source of truth — no process.env reads happen inside the call.
  describe('configureLogging', () => {
    it('applies the injected level to the logger', () => {
      logger.configureLogging({ level: 'debug' })
      expect(mockWinstonLogger.level).toBe('debug')
    })

    it('defaults the level to info when none is provided', () => {
      mockWinstonLogger.level = 'debug'
      logger.configureLogging({})
      expect(mockWinstonLogger.level).toBe('info')
    })

    it('rebuilds transports in place (clear + re-add) without touching defaultMeta', () => {
      mockWinstonLogger.defaultMeta.app = 'engineer-mcp'
      logger.configureLogging({ fileEnabled: false })
      expect(mockWinstonLogger.clear).toHaveBeenCalledOnce()
      // console transport only
      expect(mockWinstonLogger.add).toHaveBeenCalledOnce()
      // defaultMeta (and thus a prior setApp) survives the swap
      expect(mockWinstonLogger.defaultMeta.app).toBe('engineer-mcp')
    })

    it('adds console + two rotating file transports when fileEnabled is true', () => {
      logger.configureLogging({ fileEnabled: true })
      // console + 2 file transports re-added
      expect(mockWinstonLogger.add).toHaveBeenCalledTimes(3)
    })

    it('honors injected fileEnabled over the LOG_FILE_ENABLED env var (no env fallback)', () => {
      const prev = process.env.LOG_FILE_ENABLED
      process.env.LOG_FILE_ENABLED = 'true'
      try {
        // Injected config says no file logging — the env var must NOT leak in,
        // so only the console transport is added.
        logger.configureLogging({ fileEnabled: false })
        expect(mockWinstonLogger.add).toHaveBeenCalledOnce()
      } finally {
        if (prev === undefined) delete process.env.LOG_FILE_ENABLED
        else process.env.LOG_FILE_ENABLED = prev
      }
    })
  })
})
