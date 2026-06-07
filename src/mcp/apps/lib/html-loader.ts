import fs from 'node:fs'
import path from 'node:path'

const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist')

/**
 * Build a lazy, cached HTML loader for a vite-bundled MCP App. Every app
 * ships a single `dist/<appName>.html` file produced by
 * `src/mcp/apps/vite.config.js`; this helper centralizes the read + cache
 * pattern so per-app factories don't each redeclare it.
 */
export function createHtmlLoader(appName: string): () => string {
  const htmlPath = path.join(DIST_DIR, `${appName}.html`)
  let cached: string | null = null
  return () => {
    if (!cached) cached = fs.readFileSync(htmlPath, 'utf-8')
    return cached
  }
}
