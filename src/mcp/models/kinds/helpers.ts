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
