#!/usr/bin/env node
// build-illustrations.mjs
//
// Imports every authoring source file under `../pages/` and writes its
// exported figures to `../svgs/`. Pure Node — no jsdom, no browser.
//
// Naming rules for the output files:
//   - A `default` export is written as `svgs/<slug>.svg`.
//   - A named export `foo` is written as `svgs/<slug>--foo.svg`.
//   - Export names are camelCase per JS convention; the filename slug is
//     kebab-case so markers in markdown read naturally
//     (`<!-- illustration: foo#rule-violation -->`). Conversion is
//     mechanical: `ruleViolation` → `rule-violation`,
//     `defaultLayout` → `default-layout`.
//
// Each figure module is expected to export objects shaped like
// `{ svg: '<svg …>…</svg>', alt: '…' }` (see docs/illustrations/README.md
// and pages/quickstart.mjs for the canonical example).

import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, basename } from 'node:path'

const PAGES_DIR = new URL('../pages/', import.meta.url)
const SVGS_DIR = new URL('../svgs/', import.meta.url)

/** Convert a camelCase identifier to kebab-case for use in a filename. */
function camelToKebab(name) {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
}

async function main() {
  await mkdir(SVGS_DIR, { recursive: true })

  const entries = await readdir(PAGES_DIR)
  const pageFiles = entries.filter((name) => name.endsWith('.mjs')).sort()

  if (pageFiles.length === 0) {
    console.warn('No page modules found under docs/illustrations/pages/')
    return
  }

  let figureCount = 0
  for (const file of pageFiles) {
    const slug = basename(file, '.mjs')
    const pageUrl = pathToFileURL(join(fileURLToPath(PAGES_DIR), file))
    const mod = await import(pageUrl.href)

    const figures = Object.entries(mod).filter(
      ([, value]) => value && typeof value === 'object' && 'svg' in value
    )

    if (figures.length === 0) {
      console.warn(`  ${slug}: page module exports no figures, skipping.`)
      continue
    }

    for (const [exportName, figure] of figures) {
      const fileSlug = exportName === 'default' ? slug : `${slug}--${camelToKebab(exportName)}`
      const outUrl = new URL(`${fileSlug}.svg`, SVGS_DIR)
      await writeFile(outUrl, figure.svg, 'utf8')
      figureCount += 1
      console.log(`  wrote svgs/${fileSlug}.svg`)
    }
  }

  console.log(
    `Built ${figureCount} figure${figureCount === 1 ? '' : 's'} ` +
      `from ${pageFiles.length} page module${pageFiles.length === 1 ? '' : 's'}.`
  )
}

main().catch((error) => {
  console.error('illustrations:build failed:', error)
  process.exitCode = 1
})
