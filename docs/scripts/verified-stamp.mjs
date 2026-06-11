#!/usr/bin/env node
// verified-stamp — keep the "Verified against …" blockquote on every
// executable tutorial in lockstep with one pinned toolchain.
//
// The tutorials under docs/guides/ are proven by the doctest suite in
// __tests__/docs/ (run via `npm run docs:verify`), which scaffolds each page
// from a clean dir against ONE pinned CLI and links the local framework. This
// script renders the human-facing record of that toolchain so it can never
// claim a version the suite didn't run against: the stamp is GENERATED here,
// never hand-typed.
//
// Single source of truth:
//   docs/verified-with.json   → runeCli (pinned @mcp-rune/create), node, pages[]
//   package.json   version    → the @mcp-rune/mcp-rune version the suite links
//
// Usage:
//   node docs/scripts/verified-stamp.mjs           # rewrite stamps in place
//   node docs/scripts/verified-stamp.mjs --check   # dry-run; non-zero exit on drift
//
// See docs/README.md → "Verifying tutorials" for the full workflow.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = resolve(HERE, '..')
const GUIDES_DIR = join(DOCS_DIR, 'guides')
const MANIFEST_PATH = join(DOCS_DIR, 'verified-with.json')
const PKG_PATH = resolve(DOCS_DIR, '..', 'package.json')

const CHECK = process.argv.slice(2).includes('--check')

const STAMP_RE = /^>\s*Verified against .*$/m

function canonicalStamp() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  const { runeCli, node } = manifest
  return `> Verified against rune CLI ${runeCli} · @mcp-rune/mcp-rune ${pkg.version} · Node ${node}.`
}

// Insert the stamp as its own paragraph just before the first fenced code
// block — the start of the first runnable section.
function insertStamp(lines, stamp) {
  const fenceIdx = lines.findIndex((l) => /^```/.test(l))
  const at = fenceIdx === -1 ? lines.length : fenceIdx
  lines.splice(at, 0, stamp, '')
  return lines
}

function applyToPage(relPath, stamp) {
  const filePath = join(GUIDES_DIR, relPath)
  const source = readFileSync(filePath, 'utf8')
  const match = STAMP_RE.exec(source)

  if (match) {
    if (match[0] === stamp) return { relPath, status: 'ok' }
    if (CHECK) return { relPath, status: 'drift', found: match[0] }
    writeFileSync(filePath, source.replace(STAMP_RE, stamp), 'utf8')
    return { relPath, status: 'rewritten' }
  }

  if (CHECK) return { relPath, status: 'missing' }
  writeFileSync(filePath, insertStamp(source.split('\n'), stamp).join('\n'), 'utf8')
  return { relPath, status: 'inserted' }
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const stamp = canonicalStamp()
  const results = manifest.pages.map((p) => applyToPage(p, stamp))

  if (CHECK) {
    const bad = results.filter((r) => r.status === 'drift' || r.status === 'missing')
    if (bad.length === 0) {
      console.log(`✓ All ${results.length} tutorial stamp(s) match the pinned toolchain.`)
      console.log(`  ${stamp}`)
      process.exit(0)
    }
    console.log('Tutorial stamps out of sync with docs/verified-with.json:\n')
    for (const r of bad) {
      if (r.status === 'missing') console.log(`  ${r.relPath}: no "Verified against" stamp`)
      else console.log(`  ${r.relPath}: ${r.found}`)
    }
    console.log(`\nExpected:\n  ${stamp}`)
    console.log('\nRun `npm run docs:stamp` to regenerate (after `npm run docs:verify` passes).')
    process.exit(1)
  }

  const changed = results.filter((r) => r.status === 'rewritten' || r.status === 'inserted')
  if (changed.length === 0) {
    console.log(`✓ ${results.length} tutorial stamp(s) already current.`)
  } else {
    console.log('Stamped:\n')
    for (const r of changed) console.log(`  ${r.relPath}: ${r.status}`)
  }
  console.log(`  ${stamp}`)
}

main()
