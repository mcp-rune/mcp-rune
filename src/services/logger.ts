import supportsColor from 'supports-color'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'

import { getRequestId } from './request-context.js'

const { combine, timestamp, printf, json } = winston.format

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

// Auto-detect color: on for TTY stderr, off when captured by host apps
// (Claude Desktop, OpenCode) or piped to log collectors (Promtail).
// FORCE_COLOR forces on (useful under `concurrently`); NO_COLOR forces off.
const COLORIZE = Boolean(supportsColor.stderr)

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

// ANSI colors applied inline rather than via winston's `colorize()` — colorize
// wraps the lowercase level string, and uppercasing afterwards would mangle the
// `m` terminator of the ANSI escape sequence.
const LEVEL_COLOR: Record<string, string> = {
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[32m', // green
  debug: '\x1b[36m' // cyan
}
const ANSI_RESET = '\x1b[0m'

function formatLevel(level: string, colored: boolean): string {
  const word = level.toUpperCase().padEnd(5)
  if (!colored) return word
  const color = LEVEL_COLOR[level]
  return color ? `${color}${word}${ANSI_RESET}` : word
}

const ANSI_DIM = '\x1b[2m'

export function dim(text: string, colored: boolean): string {
  return colored ? `${ANSI_DIM}${text}${ANSI_RESET}` : text
}

// Phase markers carry their own semantic color independent of the log level
// (a skipped ✓ is wrong; ⊖ should always read as dim). Only the leading
// character of the message is rewritten so mid-message uses are untouched.
const SYMBOL_COLOR: Record<string, string> = {
  '▸': '\x1b[36m', // cyan  — in-progress
  '✓': '\x1b[32m', // green — success
  '✗': '\x1b[31m', // red   — failure
  '⊖': ANSI_DIM // dim   — skipped
}

export function colorizePhaseSymbol(message: string, colored: boolean): string {
  if (!colored) return message
  const symbol = message.charAt(0)
  const color = SYMBOL_COLOR[symbol]
  if (!color) return message
  return `${color}${symbol}${ANSI_RESET}${message.slice(1)}`
}

/** Indent every line of `stack` and dim it if colors are enabled. */
function renderStack(stack: string, colored: boolean): string {
  return stack
    .split('\n')
    .map((line) => `    ${dim(line, colored)}`)
    .join('\n')
}

// Human-readable format. `colored` is captured at format-construction time so
// the console transport can emit ANSI codes while the file transport stays plain.
function makeTextFormat(colored: boolean) {
  return printf(
    ({
      level,
      message,
      timestamp: ts,
      service,
      requestId,
      stack,
      causeStack,
      // Phase/summary lines already render the duration inside the message
      // (e.g. `✓ Load configuration (42ms)`). Pull durationMs out of the
      // logfmt tail so it doesn't show twice in text mode; JSON output is
      // untouched (it serializes the full info object) so structured queries
      // on per-phase durations still work.
      durationMs: _durationMs,
      ...metadata
    }) => {
      const meta = toLogfmt(metadata)
      // requestId rendered as a compact `[req:abcd1234]` prefix so it stands
      // out at a glance and doesn't clutter the logfmt metadata tail.
      const req = requestId ? `[req:${String(requestId).slice(0, 8)}]` : ''
      // Build the line from non-empty parts so absent service/requestId
      // don't leave dangling separator spaces (was `INFO   [Sentry]…` when
      // service was unset).
      const parts: string[] = [dim(ts as string, colored), formatLevel(level as string, colored)]
      if (service) parts.push(dim(`[${service}]`, colored))
      if (req) parts.push(req)
      parts.push(colorizePhaseSymbol(message as string, colored))
      let head = parts.join(' ')
      if (meta) head += ' ' + dim(meta, colored)
      if (typeof stack !== 'string' || !stack) return head
      const stackBlock = renderStack(stack, colored)
      if (typeof causeStack === 'string' && causeStack) {
        return `${head}\n${stackBlock}\n  caused by:\n${renderStack(causeStack, colored)}`
      }
      return `${head}\n${stackBlock}`
    }
  )
}

const consoleTextFormat = makeTextFormat(COLORIZE)
const fileTextFormat = makeTextFormat(false)

// Inject the current request's ID into every log entry (unless the caller
// already provided one). Reads from AsyncLocalStorage so any code path
// running inside an Express request — tool handlers, API clients, OAuth
// flows — auto-correlates without explicit threading.
const injectRequestId = winston.format((info) => {
  if (!info.requestId) {
    const id = getRequestId()
    if (id) info.requestId = id
  }
  return info
})()

// JSON format for Loki/Grafana (matches Rails lograge output)
const jsonFormat = combine(
  injectRequestId,
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  json()
)

const consoleFormat = STRUCTURED_CONSOLE
  ? jsonFormat
  : combine(injectRequestId, timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), consoleTextFormat)

// File format: JSON in production, text in development (independently configurable)
const fileFormat = STRUCTURED_FILES
  ? jsonFormat
  : combine(injectRequestId, timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), fileTextFormat)

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
