#!/usr/bin/env node
/**
 * Discover every MCP App under src/mcp/apps/<name>/ui/index.html and
 * build them all. The first app cleans dist; the rest run with
 * SKIP_CLEAN=1 so they don't wipe each other's bundles. Builds after
 * the first run in parallel.
 *
 * Adding a new app is a filesystem-only change — drop in
 * src/mcp/apps/<new-app>/ui/index.html and it joins this build.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appsDir = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(appsDir, '..', '..', '..')
const viteConfig = path.relative(repoRoot, path.join(appsDir, 'vite.config.js'))

const apps = readdirSync(appsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'dist' && d.name !== 'lib' && d.name !== 'shared')
  .map((d) => d.name)
  .filter((name) => existsSync(path.join(appsDir, name, 'ui', 'index.html')))
  .sort()

if (apps.length === 0) {
  console.error('No MCP apps discovered under src/mcp/apps/*/ui/index.html')
  process.exit(1)
}

console.log(`Building ${apps.length} apps: ${apps.join(', ')}`)

function runVite(target, { skipClean }) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', 'build', '-c', viteConfig], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BUILD_TARGET: target,
        ...(skipClean ? { SKIP_CLEAN: '1' } : {})
      },
      stdio: 'inherit'
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`vite build failed for ${target} (exit ${code})`))
    })
  })
}

const [first, ...rest] = apps

try {
  await runVite(first, { skipClean: false })
  if (rest.length > 0) {
    await Promise.all(rest.map((name) => runVite(name, { skipClean: true })))
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
