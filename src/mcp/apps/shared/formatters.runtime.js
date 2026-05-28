/**
 * Runtime descriptor overrides.
 *
 * Delivered through `AppRegistry.injectIntoHead` as an inline `<script>` that
 * runs before the app bundle:
 *
 *   `window.__MCP_RUNE_FORMATTERS__` — declarative descriptor map keyed by
 *   `"kind"` or `"kind:format"`. Translated here through a closed allowlist
 *   of operations (template substitution, badge variants, Intl locale,
 *   regex parse) so deployers can override DOM display without inline JS
 *   executing arbitrary logic. CSP-safe.
 *
 * Non-DOM behavior (parse, serialize, describe, validate, htmlInputType,
 * promptType, label) is sourced from `src/core/kind-metadata.ts` and is the
 * single source of truth shared by server and browser. New kinds register
 * via the same descriptor channel; there is no JS-hook escape valve.
 *
 * Apps import this module once, after `formatters.ts`, before they render
 * anything. Order is load-time: built-ins → declarative descriptors.
 */

import { helpers, registerFormatter } from './formatters.js'

function descriptorToFormatter(descriptor) {
  const out = {}

  if (descriptor.display?.template) {
    const tpl = descriptor.display.template
    out.format = (v) => helpers.text(tpl.replace('{value}', String(v)))
  } else if (descriptor.display?.locale) {
    const locale = descriptor.display.locale
    const dateStyle = descriptor.display.dateStyle ?? 'medium'
    const timeStyle = descriptor.display.timeStyle
    out.format = (v) => {
      if (!(v instanceof Date) || isNaN(v.getTime())) return helpers.empty()
      return helpers.text(
        new Intl.DateTimeFormat(
          locale,
          timeStyle ? { dateStyle, timeStyle } : { dateStyle }
        ).format(v)
      )
    }
  } else if (descriptor.display?.badge) {
    const variant = descriptor.display.badge
    out.format = (v) => helpers.badge(String(v), variant)
  }

  return out
}

export function applyDescriptorOverrides(win = globalThis) {
  const declarative = win.__MCP_RUNE_FORMATTERS__
  if (!declarative || typeof declarative !== 'object') return

  for (const [key, descriptor] of Object.entries(declarative)) {
    const sep = key.indexOf(':')
    const kind = sep === -1 ? key : key.slice(0, sep)
    const format = sep === -1 ? undefined : key.slice(sep + 1)
    const partial = descriptorToFormatter(descriptor)
    if (partial.format) registerFormatter(kind, { format: partial.format }, { format })
  }
}

if (typeof window !== 'undefined') {
  applyDescriptorOverrides(window)
}
