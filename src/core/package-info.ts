import { readFileSync } from 'node:fs'

export interface PackageInfo {
  name: string
  version: string
}

/**
 * Read name and version from the nearest package.json relative to a module.
 */
export function readPackageInfo(
  importMetaUrl: string,
  relativePath: string = '../package.json'
): PackageInfo {
  const pkgPath = new URL(relativePath, importMetaUrl)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
  return { name: pkg.name as string, version: pkg.version as string }
}
