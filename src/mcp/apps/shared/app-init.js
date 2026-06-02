/**
 * Shared MCP App initialization helpers.
 * Handles host context (theme, styles, fonts) setup and status bar utilities.
 * Imported by app.js files and inlined by Vite at build time.
 */

import {
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts
} from '@modelcontextprotocol/ext-apps'

export function applyHostContext(ctx, rootEl) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme)
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
  if (ctx?.safeAreaInsets && rootEl) {
    const { top = 0, right = 0, bottom = 0, left = 0 } = ctx.safeAreaInsets
    rootEl.style.paddingTop = `${top}px`
    rootEl.style.paddingRight = `${right}px`
    rootEl.style.paddingBottom = `${bottom}px`
    rootEl.style.paddingLeft = `${left}px`
  }
}

export function initApp(app, { rootEl = document.body } = {}) {
  app.onerror = console.error
  app.onteardown = async () => ({})
  app.ontoolcancelled = (params) => console.info('Tool call cancelled:', params?.reason)
  app.onhostcontextchanged = (params) => applyHostContext(params, rootEl)
  const hostContext = app.getHostContext()
  applyHostContext(hostContext, rootEl)
}

export function showStatus(statusBar, message, type = 'info') {
  statusBar.textContent = message
  statusBar.className = 'status-bar ' + type
}

export function clearStatus(statusBar) {
  statusBar.className = 'status-bar'
  statusBar.textContent = ''
}
