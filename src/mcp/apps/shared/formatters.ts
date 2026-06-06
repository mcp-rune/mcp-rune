/**
 * DOM-side formatter registry.
 *
 * Kind taxonomy + parse/serialize/toInput/fromInput/describe/validate live in
 * `src/core/kind-metadata.ts` (server- and browser-importable). This module
 * adds the only piece that requires the DOM: `format(value, opts) -> Node`,
 * consumed by find-model-app and show-model-app through `renderCellValue`,
 * and by the form apps' iframes (new-model-app / edit-model-app, via
 * `shared/model-form/main.js`) through `getFormatter`.
 *
 * Deployers extend display rendering through the declarative
 * `FormatterDescriptor` channel on `AppRegistry`, which both server and iframe
 * consume — see `formatters.runtime.js` for the descriptor → format mapping.
 */

import type { KindDescriptor, KindOpts } from '#src/mcp/models/kind-metadata.js'
import { getKind } from '#src/mcp/models/kind-metadata.js'

function humanize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface FormatHelpers {
  text(str: string | null | undefined): HTMLSpanElement
  empty(): HTMLSpanElement
  badge(label: string, opts?: { icon?: string; className?: string }): HTMLSpanElement
  link(href: string, label?: string): HTMLAnchorElement
  tagList(items: unknown[] | null | undefined, opts?: { humanizeItems?: boolean }): HTMLSpanElement
  rating(value: number, max?: number): HTMLSpanElement
  intlDateTime(
    date: Date,
    opts?: { locale?: string; dateStyle?: string; timeStyle?: string }
  ): string
  intlDate(date: Date, opts?: { locale?: string; dateStyle?: string }): string
}

export const helpers: FormatHelpers = {
  text(str) {
    const span = document.createElement('span')
    span.textContent = str == null ? '' : String(str)
    return span
  },
  empty() {
    const span = document.createElement('span')
    span.textContent = '—'
    span.style.color = 'var(--ink-4)'
    return span
  },
  badge(label, { icon, className } = {}) {
    const span = document.createElement('span')
    span.className = `mr-badge${className ? ' ' + className : ''}`
    span.textContent = icon ? `${icon} ${label}` : label
    return span
  },
  link(href, label) {
    const a = document.createElement('a')
    a.className = 'mr-detail-link'
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = label ?? href
    return a
  },
  tagList(items, { humanizeItems = true } = {}) {
    if (!items?.length) {
      const span = document.createElement('span')
      span.className = 'mr-empty-val'
      span.textContent = 'None'
      return span
    }
    const container = document.createElement('span')
    container.className = 'mr-badge-row'
    for (const item of items) {
      const tag = document.createElement('span')
      tag.className = 'mr-badge'
      tag.textContent = humanizeItems ? humanize(String(item)) : String(item)
      container.appendChild(tag)
    }
    return container
  },
  rating(value, max = 5) {
    const span = document.createElement('span')
    span.className = 'mr-rating'
    const n = Math.max(0, Math.min(max, Number(value) || 0))
    span.textContent = '★'.repeat(n) + '☆'.repeat(max - n)
    return span
  },
  intlDateTime(date, { locale, dateStyle = 'medium', timeStyle = 'short' } = {}) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale, {
      dateStyle: dateStyle as 'full' | 'long' | 'medium' | 'short',
      timeStyle: timeStyle as 'full' | 'long' | 'medium' | 'short'
    }).format(date)
  },
  intlDate(date, { locale, dateStyle = 'medium' } = {}) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale, {
      dateStyle: dateStyle as 'full' | 'long' | 'medium' | 'short'
    }).format(date)
  }
}

export type FormatRenderer = (value: unknown, opts?: FormatOpts) => Node

export interface FormatOpts extends KindOpts {
  column?: Record<string, unknown>
}

export interface Formatter extends KindDescriptor {
  format: FormatRenderer
}

const formatRegistry = new Map<string, FormatRenderer>()

const defaultFormat: FormatRenderer = (v) => helpers.text(v == null ? '' : String(v))

function key(kind: string, format?: string): string {
  return format ? `${kind.toLowerCase()}:${format.toLowerCase()}` : kind.toLowerCase()
}

/**
 * Override the DOM `format` renderer for a kind (optionally narrowed by
 * `format`). Pre-1.0: this only accepts a `format` function. Non-DOM behavior
 * (parse / serialize / describe / validate) belongs in `kind-metadata.ts`
 * descriptors and is sourced from `AppRegistry.formatters`.
 */
export function registerFormatter(
  kind: string,
  formatter: { format: FormatRenderer },
  { format }: { format?: string } = {}
): void {
  if (!formatter || typeof formatter.format !== 'function') {
    throw new Error(
      `registerFormatter expects a { format } DOM renderer. Got: ${JSON.stringify(Object.keys(formatter || {}))}`
    )
  }
  formatRegistry.set(key(kind, format), formatter.format)
}

export function getFormatter(kind: string | undefined, format?: string): Formatter {
  const descriptor = getKind(kind, format)
  const k = (kind || 'string').toLowerCase()
  const renderer = formatRegistry.get(key(k, format)) ?? formatRegistry.get(k) ?? defaultFormat
  return { ...descriptor, format: renderer }
}

/**
 * Single consumption point for list/detail/search cell rendering.
 * Returns a DOM Node ready to append. Null/undefined renders as an em-dash.
 */
export function renderCellValue(
  rawApiValue: unknown,
  column: { kind?: string; type?: string; format?: string; [k: string]: unknown } = {},
  opts: FormatOpts = {}
): Node {
  if (rawApiValue === null || rawApiValue === undefined || rawApiValue === '') {
    return helpers.empty()
  }
  const fmt = getFormatter(column.kind || column.type, column.format)
  const callOpts: FormatOpts = { column, ...opts }
  const internal = fmt.parse(rawApiValue, callOpts)
  return fmt.format(internal, callOpts)
}

registerFormatter('text', { format: (v) => helpers.text(String(v)) })

registerFormatter('integer', { format: (v) => helpers.text(String(v)) })

registerFormatter('decimal', { format: (v) => helpers.text(String(v)) })

registerFormatter('boolean', { format: (v) => helpers.text(v ? 'Yes' : 'No') })

registerFormatter('date', {
  format: (v) => helpers.text(helpers.intlDate(v as Date))
})

registerFormatter('datetime', {
  format: (v) => helpers.text(helpers.intlDateTime(v as Date))
})

registerFormatter('time', { format: (v) => helpers.text(String(v).substring(0, 5)) })

registerFormatter('enum', {
  format: (v, opts) => {
    const column = (opts?.column ?? {}) as {
      enumHints?: Record<string, { icon?: string; className?: string }>
    }
    const hint = column.enumHints?.[String(v)]
    return helpers.badge(humanize(String(v)), hint)
  }
})

registerFormatter('array', { format: (v) => helpers.tagList(v as unknown[]) })

registerFormatter('uuid', {
  format: (v) => {
    const span = helpers.text(String(v))
    span.style.fontFamily = 'var(--font-mono)'
    return span
  }
})

registerFormatter('json', {
  format: (v) => {
    const pre = document.createElement('pre')
    pre.style.margin = '0'
    pre.style.fontFamily = 'var(--font-mono)'
    pre.style.whiteSpace = 'pre-wrap'
    pre.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return pre
  }
})

registerFormatter('color', {
  format: (v) => {
    const span = document.createElement('span')
    span.className = 'mr-swatch'
    span.style.display = 'inline-flex'
    span.style.alignItems = 'center'
    span.style.gap = '6px'
    const swatch = document.createElement('span')
    swatch.style.display = 'inline-block'
    swatch.style.width = '0.9em'
    swatch.style.height = '0.9em'
    swatch.style.borderRadius = '3px'
    swatch.style.background = String(v)
    swatch.style.border = '1px solid var(--line-2)'
    span.appendChild(swatch)
    span.appendChild(document.createTextNode(String(v)))
    return span
  }
})

registerFormatter('email', { format: (v) => helpers.link(`mailto:${v}`, String(v)) })

registerFormatter('url', { format: (v) => helpers.link(String(v)) })

registerFormatter('base64', { format: () => helpers.text('(binary)') })

registerFormatter('rating', {
  format: (v, opts) => {
    const column = (opts?.column ?? {}) as { max?: number }
    return helpers.rating(Number(v) || 0, column.max ?? opts?.max ?? 5)
  }
})
