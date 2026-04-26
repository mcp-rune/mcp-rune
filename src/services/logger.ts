import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

const { combine, timestamp, printf, colorize, json } = winston.format

const LOG_LEVEL = process.env.LOG_LEVEL || 'info'

// Independent format control for console (stderr) and file transports:
//   LOG_FORMAT      — controls console format: 'text' (default) or 'json'
//   LOG_FILE_FORMAT — controls file format: inherits from LOG_FORMAT if not set
//   NODE_ENV=production forces both to JSON
const STRUCTURED_CONSOLE =
  process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production'
const STRUCTURED_FILES =
  (process.env.LOG_FILE_FORMAT ?? process.env.LOG_FORMAT) === 'json' ||
  process.env.NODE_ENV === 'production'

// MCP servers default to plain output — stderr is typically captured by host
// apps (Claude Desktop, OpenCode) or piped to log collectors (Promtail).
// Set FORCE_COLOR=1 to enable colorized output (e.g. via concurrently).
const COLORIZE = 'FORCE_COLOR' in process.env

/** Format a metadata value for logfmt-style text output */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.includes(' ') ? `"${v}"` : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Render metadata as key=value pairs (logfmt convention) */
function toLogfmt(metadata: Record<string, unknown>): string {
  const pairs: string[] = []
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'app') continue // app label is noise in text mode — service identifies the component
    const formatted = formatValue(v)
    if (formatted) pairs.push(`${k}=${formatted}`)
  }
  return pairs.join(' ')
}

// Human-readable format for development
const textFormat = printf(({ level, message, timestamp: ts, service, ...metadata }) => {
  const meta = toLogfmt(metadata)
  const svc = service ? `[${service}]` : ''
  return `${ts} [${level}] ${svc} ${message}${meta ? ' ' + meta : ''}`
})

// JSON format for Loki/Grafana (matches Rails lograge output)
const jsonFormat = combine(timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), json())

// Console format: JSON in production, colorized text in development
const textParts = COLORIZE
  ? [colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), textFormat]
  : [timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), textFormat]

const consoleFormat = STRUCTURED_CONSOLE
  ? combine(timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), json())
  : combine(...textParts)

// File format: JSON in production, text in development (independently configurable)
const fileFormat = STRUCTURED_FILES
  ? jsonFormat
  : combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), textFormat)

const transports: winston.transport[] = [
  new winston.transports.Console({
    stderrLevels: ['error', 'warn', 'info', 'debug'], // Use stderr to avoid corrupting stdio MCP transport
    format: consoleFormat
  })
]

// File logging is conditional because:
// - Claude Desktop runs MCP servers in a sandboxed read-only filesystem
// - The sandbox prevents creating the logs/ directory (EROFS: read-only file system)
// - For stdio transport (local dev), file logging is unnecessary anyway since
//   Claude Desktop captures stderr and writes it to ~/Library/Logs/Claude/mcp-server-*.log
// - Enable file logging for remote/HTTP deployments where no parent process captures stderr
if (process.env.LOG_FILE_ENABLED === 'true') {
  // `auditFile` is pinned to a stable path per transport. Without this,
  // winston-daily-rotate-file derives the audit filename from a hash that
  // includes a per-process nonce, so every restart creates a brand-new
  // bookkeeping file (e.g. `.6a8385...-audit.json`) and tracks only the
  // rotations it performed itself. Files written under previous audits
  // become orphans the library never reaps — silently defeating
  // `maxFiles: '7d'` retention on any long-lived deployment that restarts
  // occasionally, and producing indefinitely-accumulating `combined-*.log`
  // files in development. Pinning the audit path makes every process
  // instance share the same ledger so retention actually applies.
  transports.push(
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '7d', // Match Loki retention
      auditFile: 'logs/.combined-audit.json',
      format: fileFormat
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '7d', // Match Loki retention
      auditFile: 'logs/.error-audit.json',
      level: 'error',
      format: fileFormat
    })
  )
}

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { app: 'mcp-servers' }, // Add app label for Loki queries
  transports
})

export interface LogMeta {
  [key: string]: unknown
}

export function debug(message: string, meta: LogMeta = {}): void {
  logger.debug(message, meta)
}

export function info(message: string, meta: LogMeta = {}): void {
  logger.info(message, meta)
}

export function warn(message: string, meta: LogMeta = {}): void {
  logger.warn(message, meta)
}

export function error(message: string, meta: LogMeta = {}): void {
  logger.error(message, meta)
}

/**
 * Set the app label used in all log entries.
 * Call once during startup after server identity is known.
 */
export function setApp(name: string): void {
  logger.defaultMeta.app = name
}

/**
 * Create a child logger with default metadata
 */
export function child(defaultMeta: LogMeta = {}): {
  info: (message: string, meta?: LogMeta) => void
  warn: (message: string, meta?: LogMeta) => void
  error: (message: string, meta?: LogMeta) => void
  debug: (message: string, meta?: LogMeta) => void
} {
  const childLogger = logger.child(defaultMeta)

  return {
    info: (message: string, meta: LogMeta = {}) => childLogger.info(message, meta),
    warn: (message: string, meta: LogMeta = {}) => childLogger.warn(message, meta),
    error: (message: string, meta: LogMeta = {}) => childLogger.error(message, meta),
    debug: (message: string, meta: LogMeta = {}) => childLogger.debug(message, meta)
  }
}

export default logger
