/**
 * Helpers shared by more than one kind file. Single-use helpers (e.g. the
 * UUID/email/time regexes) live inline in their kind file.
 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function humanize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Membership check shared by the `enum` and `array` kinds. Accepts scalar or
 * array values; a missing/empty `enumValues` list means "no constraint".
 */
export function enumMembershipError(
  value: unknown,
  enumValues: readonly string[] | undefined
): string | null {
  if (!enumValues || enumValues.length === 0) return null
  const values = Array.isArray(value) ? value : [value]
  const invalid = values.filter((v) => !enumValues.includes(String(v)))
  return invalid.length > 0
    ? `must be one of: ${enumValues.join(', ')} (got "${invalid.join(', ')}")`
    : null
}

export function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const d = new Date(v as string | number)
  return isNaN(d.getTime()) ? null : d
}

export function dateToISO(v: Date): string {
  return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`
}

export function dateToInputDateTime(v: Date): string {
  return `${dateToISO(v)}T${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`
}
