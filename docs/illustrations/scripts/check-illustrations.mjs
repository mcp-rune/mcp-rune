#!/usr/bin/env node
// check-illustrations.mjs
//
// Drift check: rebuilds every figure into a temporary directory and
// compares the result byte-for-byte against the committed svgs/.
// Exits non-zero if anything differs — that means someone edited a
// page module without re-running `npm run illustrations:build`.

import { mkdtemp, readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'

const PAGES_DIR = new URL('../pages/', import.meta.url)
const SVGS_DIR = new URL('../svgs/', import.meta.url)

/** Convert a camelCase identifier to kebab-case. Mirrors build-illustrations.mjs. */
function camelToKebab(name) {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
}

async function buildInto(targetDir) {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(PAGES_DIR)
  const pageFiles = entries.filter((name) => name.endsWith('.mjs')).sort()

  for (const file of pageFiles) {
    const slug = basename(file, '.mjs')
    const pageUrl = pathToFileURL(join(fileURLToPath(PAGES_DIR), file))
    const mod = await import(pageUrl.href)
    const figures = Object.entries(mod).filter(
      ([, value]) => value && typeof value === 'object' && 'svg' in value
    )
    for (const [exportName, figure] of figures) {
      const fileSlug = exportName === 'default' ? slug : `${slug}--${camelToKebab(exportName)}`
      await writeFile(join(targetDir, `${fileSlug}.svg`), figure.svg, 'utf8')
    }
  }
}

async function readSvgDir(dir) {
  const entries = await readdir(dir)
  const svgFiles = entries.filter((name) => name.endsWith('.svg')).sort()
  const out = new Map()
  for (const file of svgFiles) {
    out.set(file, await readFile(join(dir, file), 'utf8'))
  }
  return out
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'illustrations-check-'))
  try {
    await buildInto(work)

    const fresh = await readSvgDir(work)
    const committed = await readSvgDir(fileURLToPath(SVGS_DIR)).catch(() => new Map())

    const drifted = []
    for (const [file, body] of fresh) {
      if (committed.get(file) !== body) drifted.push(file)
    }
    for (const file of committed.keys()) {
      if (!fresh.has(file)) drifted.push(`(stale) ${file}`)
    }

    if (drifted.length > 0) {
      console.error('illustrations:check FAILED — committed svgs are stale:')
      for (const file of drifted) console.error(`  - ${file}`)
      console.error('\nRun `npm run illustrations:build` and commit the result.')
      process.exitCode = 1
      return
    }

    console.log(`illustrations:check OK — ${fresh.size} svgs match.`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('illustrations:check failed:', error)
  process.exitCode = 1
})
