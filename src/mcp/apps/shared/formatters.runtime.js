/**
 * Runtime formatter overrides.
 *
 * Two channels, both delivered through `AppRegistry.injectIntoHead` as
 * an inline `<script>` that runs before the app bundle:
 *
 *   1. `window.__MCP_RUNE_FORMATTERS__` — declarative descriptor map
 *      ({ "kind" | "kind:format" -> { display?, parser?, input? } }).
 *      Translated here through a closed allowlist of operations
 *      (template substitution, badge variants, Intl locale, regex parse)
 *      so deployers can override behavior without inline JS executing
 *      arbitrary logic. CSP-safe.
 *
 *   2. `window.__MCP_RUNE_REGISTER_FORMATTERS__(registerFormatter, helpers)`
 *      — JS hook for custom kinds the framework doesn't ship (currency,
 *      phone, isbn, deployment-specific time). Runs after built-ins are
 *      registered, so deployers can also fully replace any built-in.
 *
 * Apps import this module once, after `formatters.js`, before they
 * render anything. The order is load-time: built-ins → declarative
 * descriptors → custom JS hook.
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
    out.parse = (v) => {
      if (!v) return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d
    }
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

  if (descriptor.parser?.regex && descriptor.parser?.replacement !== undefined) {
    const re = new RegExp(descriptor.parser.regex)
    const repl = descriptor.parser.replacement
    const inner = out.parse
    out.parse = (v) => {
      const fromInner = inner ? inner(v) : v
      if (typeof fromInner === 'string') return fromInner.replace(re, repl)
      return fromInner
    }
  }

  return out
}

export function applyRuntimeOverrides(win = globalThis) {
  const declarative = win.__MCP_RUNE_FORMATTERS__
  if (declarative && typeof declarative === 'object') {
    for (const [key, descriptor] of Object.entries(declarative)) {
      const sep = key.indexOf(':')
      const kind = sep === -1 ? key : key.slice(0, sep)
      const format = sep === -1 ? undefined : key.slice(sep + 1)
      registerFormatter(kind, descriptorToFormatter(descriptor), { format })
    }
  }

  const hook = win.__MCP_RUNE_REGISTER_FORMATTERS__
  if (typeof hook === 'function') {
    hook(registerFormatter, helpers)
  }
}

if (typeof window !== 'undefined') {
  applyRuntimeOverrides(window)
}
