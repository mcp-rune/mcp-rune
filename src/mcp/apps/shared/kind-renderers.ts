/**
 * Browser DOM rendering for kinds.
 *
 * The kind taxonomy (parse / serialize / toInput / fromInput / describe /
 * validate / label / htmlInputType / promptType) lives in
 * `src/mcp/models/kinds/`. This module is the only place that adds the one
 * piece those descriptors cannot carry: `render(value, opts) -> Node`.
 *
 * `getKindRenderer(kind, format)` returns a kind descriptor decorated with a
 * `render` function. `renderCellValue` is the single consumption point for
 * list, detail, and search cell rendering. Deployers extend rendering
 * through the `kinds: { <name>: { render: { … } } }` option on
 * `AppRegistry`, which the iframe runtime in `kind-renderers.runtime.js`
 * translates into `registerKindRenderer` calls before the bundled app code
 * runs.
 */

import type { KindDescriptor, KindOpts } from '#src/mcp/models/kinds/index.js'
import { getKind } from '#src/mcp/models/kinds/index.js'

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

export type KindRenderer = (value: unknown, opts?: KindRenderOpts) => Node

export interface KindRenderOpts extends KindOpts {
  column?: Record<string, unknown>
}

export interface KindWithRenderer extends KindDescriptor {
  render: KindRenderer
}

const rendererRegistry = new Map<string, KindRenderer>()

const defaultRender: KindRenderer = (v) => helpers.text(v == null ? '' : String(v))

function key(kind: string, format?: string): string {
  return format ? `${kind.toLowerCase()}:${format.toLowerCase()}` : kind.toLowerCase()
}

/**
 * Override the DOM `render` function for a kind (optionally narrowed by
 * `format`). Non-DOM behavior (parse / serialize / describe / validate)
 * stays in `src/mcp/models/kinds/`; this layer only adds the
 * `(value, opts) => Node` decoration.
 */
export function registerKindRenderer(
  kind: string,
  renderer: { render: KindRenderer },
  { format }: { format?: string } = {}
): void {
  if (!renderer || typeof renderer.render !== 'function') {
    throw new Error(
      `registerKindRenderer expects a { render } DOM renderer. Got: ${JSON.stringify(Object.keys(renderer || {}))}`
    )
  }
  rendererRegistry.set(key(kind, format), renderer.render)
}

export function getKindRenderer(kind: string | undefined, format?: string): KindWithRenderer {
  const descriptor = getKind(kind, format)
  const k = (kind || 'string').toLowerCase()
  const render = rendererRegistry.get(key(k, format)) ?? rendererRegistry.get(k) ?? defaultRender
  return { ...descriptor, render }
}

/**
 * Single consumption point for list/detail/search cell rendering.
 * Returns a DOM Node ready to append. Null/undefined renders as an em-dash.
 */
export function renderCellValue(
  rawApiValue: unknown,
  column: { kind?: string; type?: string; format?: string; [k: string]: unknown } = {},
  opts: KindRenderOpts = {}
): Node {
  if (rawApiValue === null || rawApiValue === undefined || rawApiValue === '') {
    return helpers.empty()
  }
  const r = getKindRenderer(column.kind || column.type, column.format)
  const callOpts: KindRenderOpts = { column, ...opts }
  const internal = r.parse(rawApiValue, callOpts)
  return r.render(internal, callOpts)
}

registerKindRenderer('text', { render: (v) => helpers.text(String(v)) })

registerKindRenderer('integer', { render: (v) => helpers.text(String(v)) })

registerKindRenderer('decimal', { render: (v) => helpers.text(String(v)) })

registerKindRenderer('boolean', { render: (v) => helpers.text(v ? 'Yes' : 'No') })

registerKindRenderer('date', {
  render: (v) => helpers.text(helpers.intlDate(v as Date))
})

registerKindRenderer('datetime', {
  render: (v) => helpers.text(helpers.intlDateTime(v as Date))
})

registerKindRenderer('time', { render: (v) => helpers.text(String(v).substring(0, 5)) })

registerKindRenderer('enum', {
  render: (v, opts) => {
    const column = (opts?.column ?? {}) as {
      enumHints?: Record<string, { icon?: string; className?: string }>
    }
    const hint = column.enumHints?.[String(v)]
    return helpers.badge(humanize(String(v)), hint)
  }
})

registerKindRenderer('array', { render: (v) => helpers.tagList(v as unknown[]) })

registerKindRenderer('uuid', {
  render: (v) => {
    const span = helpers.text(String(v))
    span.style.fontFamily = 'var(--font-mono)'
    return span
  }
})

registerKindRenderer('json', {
  render: (v) => {
    const pre = document.createElement('pre')
    pre.style.margin = '0'
    pre.style.fontFamily = 'var(--font-mono)'
    pre.style.whiteSpace = 'pre-wrap'
    pre.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return pre
  }
})

registerKindRenderer('color', {
  render: (v) => {
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

registerKindRenderer('email', { render: (v) => helpers.link(`mailto:${v}`, String(v)) })

registerKindRenderer('url', { render: (v) => helpers.link(String(v)) })

registerKindRenderer('base64', { render: () => helpers.text('(binary)') })

registerKindRenderer('rating', {
  render: (v, opts) => {
    const column = (opts?.column ?? {}) as { max?: number }
    return helpers.rating(Number(v) || 0, column.max ?? opts?.max ?? 5)
  }
})
