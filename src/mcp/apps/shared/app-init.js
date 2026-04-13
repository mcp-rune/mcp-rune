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

export function applyHostContext(ctx) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme)
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
}

export function initApp(app) {
  app.onerror = console.error
  app.onhostcontextchanged = (params) => applyHostContext(params)
  const hostContext = app.getHostContext()
  applyHostContext(hostContext)
}

export function showStatus(statusBar, message, type = 'info') {
  statusBar.textContent = message
  statusBar.className = 'status-bar ' + type
}

export function clearStatus(statusBar) {
  statusBar.className = 'status-bar'
  statusBar.textContent = ''
}
