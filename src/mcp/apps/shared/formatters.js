/**
 * Bidirectional attribute-kind formatter registry.
 *
 * One source of truth for how attribute kinds (string, text, integer,
 * decimal, boolean, date, datetime, time, enum, array, uuid, json, color,
 * email, url, base64, rating) move between three representations:
 *
 *   API value  ⇄  internal value  ⇄  HTML <input> value
 *      (parse / serialize)         (fromInput / toInput)
 *
 * Display rendering is `format(internal, opts) -> DOM Node`, consumed by
 * list-view, record-detail, and search-view through `renderCellValue`.
 * Form inputs use `parse` + `toInput` on prefill and `fromInput` + `serialize`
 * on submit.
 *
 * Deployers extend the registry with custom kinds (currency, phone, isbn,
 * deployment-specific time) via `registerFormatter` from a `formatterScript`
 * supplied through `AppRegistry`. Built-in formatters can also be overridden
 * declaratively via descriptors in `window.__MCP_RUNE_FORMATTERS__`.
 */

import { humanize } from './helpers.js'

const registry = new Map()

export const helpers = {
  text(str) {
    const span = document.createElement('span')
    span.textContent = str ?? ''
    return span
  },

  empty() {
    const span = document.createElement('span')
    span.textContent = '—'
    span.style.color = 'var(--color-text-info)'
    return span
  },

  badge(label, { icon, className } = {}) {
    const span = document.createElement('span')
    span.className = `status-badge${className ? ' ' + className : ''}`
    span.textContent = icon ? `${icon} ${label}` : label
    return span
  },

  link(href, label) {
    const a = document.createElement('a')
    a.className = 'detail-link'
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = label ?? href
    return a
  },

  tagList(items, { humanizeItems = true } = {}) {
    if (!items?.length) {
      const span = document.createElement('span')
      span.className = 'empty-value'
      span.textContent = 'None'
      return span
    }
    const container = document.createElement('span')
    container.className = 'tag-list'
    for (const item of items) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = humanizeItems ? humanize(String(item)) : String(item)
      container.appendChild(tag)
    }
    return container
  },

  rating(value, max = 5) {
    const span = document.createElement('span')
    span.className = 'rating'
    const n = Math.max(0, Math.min(max, Number(value) || 0))
    span.textContent = '★'.repeat(n) + '☆'.repeat(max - n)
    return span
  },

  intlDateTime(date, { locale, dateStyle = 'medium', timeStyle = 'short' } = {}) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale, { dateStyle, timeStyle }).format(date)
  },

  intlDate(date, { locale, dateStyle = 'medium' } = {}) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale, { dateStyle }).format(date)
  }
}

const passthrough = {
  parse: (v) => v,
  format: (v) => helpers.text(String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : v),
  serialize: (v) => v
}

/**
 * Register a formatter for a kind, optionally narrowed to a `format` discriminator
 * (e.g. `registerFormatter('string', isbnFormatter, { format: 'isbn' })`).
 * Partial formatters are merged onto the passthrough defaults so callers only
 * need to specify what differs.
 */
export function registerFormatter(kind, formatter, { format } = {}) {
  const key = format ? `${kind}:${format}` : kind
  registry.set(key, { ...passthrough, ...formatter })
}

export function getFormatter(kind, format) {
  if (format && registry.has(`${kind}:${format}`)) return registry.get(`${kind}:${format}`)
  if (kind && registry.has(kind)) return registry.get(kind)
  return registry.get('string')
}

/**
 * Single consumption point for list/detail/search cell rendering.
 * Returns a DOM Node ready to append. Null/undefined renders as an em-dash.
 */
export function renderCellValue(rawApiValue, column = {}, opts = {}) {
  if (rawApiValue === null || rawApiValue === undefined || rawApiValue === '') {
    return helpers.empty()
  }
  const fmt = getFormatter(column.kind || column.type, column.format)
  const internal = fmt.parse(rawApiValue, { column, ...opts })
  return fmt.format(internal, { column, ...opts })
}

// ─── Built-in formatters ─────────────────────────────────────────────────

registerFormatter('string', passthrough)

registerFormatter('text', {
  format: (v) => helpers.text(String(v))
})

registerFormatter('integer', {
  parse: (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  format: (v) => helpers.text(String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  serialize: (v) => v
})

registerFormatter('decimal', {
  parse: (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  format: (v) => helpers.text(String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  serialize: (v) => v
})

registerFormatter('boolean', {
  parse: (v) => v === true || v === 'true' || v === 1 || v === '1',
  format: (v) => helpers.text(v ? 'Yes' : 'No'),
  toInput: (v) => (v ? 'true' : 'false'),
  fromInput: (v) => v === true || v === 'true' || v === 'on',
  serialize: (v) => Boolean(v)
})

registerFormatter('date', {
  parse: (v) => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  },
  format: (v, opts = {}) => helpers.text(helpers.intlDate(v, opts)),
  toInput: (v) => {
    if (!(v instanceof Date) || isNaN(v.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  },
  fromInput: (v) => (v ? new Date(`${v}T00:00:00Z`) : null),
  serialize: (v) => {
    if (!(v instanceof Date) || isNaN(v.getTime())) return null
    const pad = (n) => String(n).padStart(2, '0')
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  }
})

registerFormatter('datetime', {
  parse: (v) => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  },
  format: (v, opts = {}) => helpers.text(helpers.intlDateTime(v, opts)),
  toInput: (v) => {
    if (!(v instanceof Date) || isNaN(v.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`
  },
  fromInput: (v) => (v ? new Date(`${v}:00Z`) : null),
  serialize: (v) => {
    if (!(v instanceof Date) || isNaN(v.getTime())) return null
    return v.toISOString()
  }
})

registerFormatter('time', {
  parse: (v) => (v ? String(v) : null),
  format: (v) => helpers.text(v.substring(0, 5)),
  toInput: (v) => (v ? v.substring(0, 5) : ''),
  fromInput: (v) => v || null,
  serialize: (v) => v
})

registerFormatter('enum', {
  format: (v, { column = {} } = {}) => {
    const hint = column.enumHints?.[v]
    return helpers.badge(humanize(String(v)), hint)
  }
})

registerFormatter('array', {
  parse: (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
  format: (v) => helpers.tagList(v),
  toInput: (v) => (Array.isArray(v) ? v.join(',') : ''),
  fromInput: (v) =>
    v
      ? String(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  serialize: (v) => (Array.isArray(v) ? v : [])
})

registerFormatter('uuid', {
  format: (v) => {
    const span = helpers.text(String(v))
    span.style.fontFamily = 'var(--font-mono)'
    return span
  }
})

registerFormatter('json', {
  parse: (v) => v,
  format: (v) => {
    const pre = document.createElement('pre')
    pre.style.margin = '0'
    pre.style.fontFamily = 'var(--font-mono)'
    pre.style.whiteSpace = 'pre-wrap'
    pre.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return pre
  },
  toInput: (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2)),
  fromInput: (v) => {
    if (!v) return null
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  },
  serialize: (v) => v
})

registerFormatter('color', {
  format: (v) => {
    const span = document.createElement('span')
    span.className = 'color-swatch'
    span.style.display = 'inline-flex'
    span.style.alignItems = 'center'
    span.style.gap = 'var(--spacing-xs)'
    const swatch = document.createElement('span')
    swatch.style.display = 'inline-block'
    swatch.style.width = '0.9em'
    swatch.style.height = '0.9em'
    swatch.style.borderRadius = '3px'
    swatch.style.background = String(v)
    swatch.style.border = '1px solid var(--border)'
    span.appendChild(swatch)
    span.appendChild(document.createTextNode(String(v)))
    return span
  }
})

registerFormatter('email', {
  format: (v) => helpers.link(`mailto:${v}`, String(v))
})

registerFormatter('url', {
  format: (v) => helpers.link(String(v))
})

registerFormatter('base64', {
  format: () => helpers.text('(binary)')
})

registerFormatter('rating', {
  parse: (v) => Number(v) || 0,
  format: (v, { column = {} } = {}) => helpers.rating(v, column.max ?? 5),
  toInput: (v) => String(v),
  fromInput: (v) => (v === '' ? null : Number(v)),
  serialize: (v) => v
})
