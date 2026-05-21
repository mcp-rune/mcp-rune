/**
 * Error Hints
 *
 * Maps common POSIX/Node error codes to short human-readable hints
 * that get appended to error log messages. Saves the operator a
 * search round-trip when an EADDRINUSE / ECONNREFUSED / etc. shows up
 * in production logs.
 *
 * Returns `undefined` for unknown codes; callers should treat the
 * hint as a bonus, not a required field.
 */

const HINTS: Record<string, string> = {
  EADDRINUSE: 'another process is using that port — find it with `lsof -ti:<port>`',
  ECONNREFUSED: 'target service may be down or not yet listening',
  ENOTFOUND: 'DNS lookup failed — check the hostname',
  EACCES: 'permission denied — ports < 1024 require elevated privileges',
  ETIMEDOUT: 'connection timed out — target may be unreachable or firewalled',
  EHOSTUNREACH: 'host unreachable — check network connectivity',
  EPIPE: 'broken pipe — the other side closed the connection'
}

/** Returns a hint string for a known error code, or `undefined`. */
export function hintForError(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? HINTS[code] : undefined
}
