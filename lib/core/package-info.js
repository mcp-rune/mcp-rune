import { readFileSync } from 'fs'

/**
 * Read name and version from the nearest package.json relative to a module.
 *
 * @param {string} importMetaUrl - The calling module's `import.meta.url`
 * @param {string} [relativePath='../package.json'] - Relative path from the module to its package.json
 * @returns {{ name: string, version: string }}
 */
export function readPackageInfo(importMetaUrl, relativePath = '../package.json') {
  const pkgPath = new URL(relativePath, importMetaUrl)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  return { name: pkg.name, version: pkg.version }
}
