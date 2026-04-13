import { describe, it, expect, vi, beforeEach } from 'vitest'

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

  return {
    default: {
      createLogger: vi.fn(() => mockLogger),
      format: {
        combine: vi.fn((...args) => args),
        timestamp: vi.fn(() => 'timestamp-format'),
        printf: vi.fn((fn) => fn),
        colorize: vi.fn(() => 'colorize'),
        json: vi.fn(() => 'json-format')
      },
      transports: {
        Console: vi.fn()
      }
    }
  }
})

vi.mock('winston-daily-rotate-file', () => ({
  default: vi.fn()
}))

const logger = await import('../../../lib/services/logger.js')
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
      logger.setApp('engineer-mcp')
      expect(mockWinstonLogger.defaultMeta.app).toBe('engineer-mcp')
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
        await import('../../../lib/services/logger.js')
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
