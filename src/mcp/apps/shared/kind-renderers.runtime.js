/**
 * Iframe runtime: declarative kind renderers from AppRegistry.
 *
 * Delivered through `AppRegistry.injectIntoHead` as an inline `<script>` that
 * runs before the app bundle. The injected blob looks like:
 *
 *   window.__MCP_RUNE_KIND_RENDERERS__ = {
 *     "string:isbn": { template: "ISBN: {value}" },
 *     "date":        { locale: "en-GB", dateStyle: "long" }
 *   }
 *
 * Each value is a `KindRenderHint` — a closed allowlist of display operations
 * (template substitution, `Intl.DateTimeFormat` locale, badge variant) that
 * this module compiles into a DOM renderer and hands to `registerKindRenderer`.
 * CSP-safe: never executes inline JS.
 *
 * Server-side behavior (parse, serialize, validate, describe, htmlInputType,
 * promptType, label) is sourced from `src/mcp/models/kinds/` — the single
 * source of truth. AppRegistry registers the descriptor half there at
 * construction time; only the `render` hint flows through this module.
 */

import { helpers, registerKindRenderer } from './kind-renderers.js'

function hintToRenderer(hint) {
  if (hint?.template) {
    const tpl = hint.template
    return (v) => helpers.text(tpl.replace('{value}', String(v)))
  }
  if (hint?.locale) {
    const locale = hint.locale
    const dateStyle = hint.dateStyle ?? 'medium'
    const timeStyle = hint.timeStyle
    return (v) => {
      if (!(v instanceof Date) || isNaN(v.getTime())) return helpers.empty()
      return helpers.text(
        new Intl.DateTimeFormat(
          locale,
          timeStyle ? { dateStyle, timeStyle } : { dateStyle }
        ).format(v)
      )
    }
  }
  if (hint?.badge) {
    const variant = hint.badge
    return (v) => helpers.badge(String(v), variant)
  }
  return null
}

export function applyKindRenderers(win = globalThis) {
  const declarative = win.__MCP_RUNE_KIND_RENDERERS__
  if (!declarative || typeof declarative !== 'object') return

  for (const [k, hint] of Object.entries(declarative)) {
    const sep = k.indexOf(':')
    const kind = sep === -1 ? k : k.slice(0, sep)
    const format = sep === -1 ? undefined : k.slice(sep + 1)
    const render = hintToRenderer(hint)
    if (render) registerKindRenderer(kind, { render }, { format })
  }
}

if (typeof window !== 'undefined') {
  applyKindRenderers(window)
}
