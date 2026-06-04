#!/usr/bin/env node
// dualize — keep every code example in the framework guides paired across
// TypeScript and JavaScript.
//
// Two adjacent fenced code blocks tagged `ts` and `js` with matching
// `file=` meta (extension stripped) render as a single CodeSnippet on
// mcp-rune-site (see src/lib/remark-code-pairs.mjs in that repo). This
// script enforces the convention upstream — it scans every .md guide,
// finds language-tagged blocks without a sibling, and synthesizes one.
//
// Usage:
//   node docs/scripts/dualize.mjs                       # apply transforms in place
//   node docs/scripts/dualize.mjs --check               # dry-run; non-zero exit if unpaired exist
//   node docs/scripts/dualize.mjs --report-placeholders # list auto-generated JS placeholders (hand-authoring candidates)
//   node docs/scripts/dualize.mjs --guide=<slug>        # only one guide
//
// Conversion rules:
//   ts → js   : type annotations stripped via typescript.transpileModule
//               (falls back to regex strip for blocks the compiler rejects)
//   js → ts   : duplicated verbatim (JS is generally valid TS)
//   pure type-only blocks (interface / type / declare with no runtime tokens):
//               emit a JSDoc @typedef-style block as the JS sibling
//
// See docs/README.md for the full convention reference.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { basename, join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const GUIDES_DIR = resolve(HERE, '..', 'guides')

// ── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const REPORT_PLACEHOLDERS = args.includes('--report-placeholders')
const GUIDE_FLAG = args.find((a) => a.startsWith('--guide='))
const ONLY_GUIDE = GUIDE_FLAG ? GUIDE_FLAG.slice('--guide='.length) : null

// Signature of an auto-generated placeholder JS body: the header emitted by
// `typeOnlyToJsdoc` when the script can't transpile a type-only TS block.
// Hand-authored JSDoc @typedef blocks do not contain this phrase.
const PLACEHOLDER_HEADER = 'Types are a TypeScript-only artifact'
const isPlaceholderJsBody = (body) => body.includes(PLACEHOLDER_HEADER)

// ── Block parsing ───────────────────────────────────────────────────
// State machine: track ``` openings, language tag, meta, body, line numbers.
// Handles nested triple-backticks inside language=`markdown`/`md` blocks by
// requiring the closing fence to be the same length as the opener.

function parseBlocks(markdown) {
  const lines = markdown.split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const open = /^(`{3,})([A-Za-z0-9_+-]*)(.*)$/.exec(line)
    if (open) {
      const fence = open[1]
      const lang = open[2] || ''
      const meta = (open[3] || '').trim()
      const startLine = i
      i += 1
      const bodyStart = i
      while (i < lines.length && !lines[i].startsWith(fence)) {
        // strict prefix check — same-length closing fence
        if (new RegExp(`^${fence}\\s*$`).test(lines[i])) break
        i += 1
      }
      const bodyEnd = i // exclusive
      const endLine = i
      blocks.push({
        fence,
        lang: lang.toLowerCase(),
        meta,
        body: lines.slice(bodyStart, bodyEnd).join('\n'),
        startLine,
        endLine
      })
      i += 1 // skip closing fence
    } else {
      i += 1
    }
  }
  return blocks
}

// ── Meta parsing ────────────────────────────────────────────────────

function parseMeta(meta) {
  if (!meta) return {}
  const out = {}
  const re = /(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
  let m
  while ((m = re.exec(meta)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4]
  }
  return out
}

function baseFile(filePath) {
  if (!filePath) return null
  return filePath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
}

// ── Language classification ────────────────────────────────────────

const TS_TAGS = new Set(['ts', 'typescript'])
const JS_TAGS = new Set(['js', 'javascript'])

const isTs = (lang) => TS_TAGS.has(lang)
const isJs = (lang) => JS_TAGS.has(lang)
const isLanguageBlock = (lang) => isTs(lang) || isJs(lang)

// ── Naming rule ─────────────────────────────────────────────────────
// Derive a `src/<dir>/<kebab-name>.<ext>` path from the first identifier in
// the block. Suffix heuristics map common naming conventions to directories.

const SUFFIX_DIRS = [
  [/Tool$/, 'src/tools'],
  [/Service$/, 'src/services'],
  [/Adapter$/, 'src/adapters'],
  [/Convention$/, 'src/conventions'],
  [/Strategy$/, 'src/strategies'],
  [/Extension$/, 'src/extensions'],
  [/Client$/, 'src/clients'],
  [/Layer$/, 'src/layers'],
  [/App$/, 'src/apps'],
  [/Prompt$/, 'src/prompts'],
  [/Workflow$/, 'src/workflows'],
  [/Convention$/, 'src/conventions'],
  [/Model$/, 'src/models'],
  [/Registry$/, 'src/registries'],
  [/Schema$/, 'src/schemas'],
  [/Store$/, 'src/stores'],
  [/Config$/, 'src/config'],
  [/Types$/, 'src/types']
]

function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

function inferDirectory(identifier) {
  for (const [re, dir] of SUFFIX_DIRS) {
    if (re.test(identifier)) return dir
  }
  return 'src'
}

function extractIdentifier(source) {
  // Walk patterns in priority order; first match wins.
  const patterns = [
    /(?:export\s+)?(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]*)/,
    /(?:export\s+)?(?:async\s+)?function\s+([a-z_][A-Za-z0-9_]*)/,
    /(?:export\s+)?(?:const|let|var)\s+([a-z_][A-Za-z0-9_]*)\s*=/,
    /(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]*)/,
    /(?:export\s+)?type\s+([A-Z][A-Za-z0-9_]*)\s*=/,
    /(?:export\s+)?enum\s+([A-Z][A-Za-z0-9_]*)/
  ]
  for (const re of patterns) {
    const m = re.exec(source)
    if (m) return m[1]
  }
  return null
}

function synthesizeFileMeta(body, guideSlug, ordinal, ext) {
  const ident = extractIdentifier(body)
  if (ident) {
    const dir = inferDirectory(ident)
    const name = kebab(ident.replace(/Types$/, '-types'))
    return `${dir}/${name}.${ext}`
  }
  return `examples/${guideSlug}-${String(ordinal).padStart(2, '0')}.${ext}`
}

// ── Type-only detection ────────────────────────────────────────────

function isTypeOnly(source) {
  // Strip comments + import type lines, then check whether the rest contains
  // runtime tokens (function/const/let/var/class/return/await/etc.).
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/^\s*import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  // After stripping, does anything except interface/type/declare/enum remain?
  // Allow blank lines.
  const lines = stripped.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return false
  for (const line of lines) {
    const trimmed = line.trim()
    if (
      !/^(export\s+)?(abstract\s+)?(interface|type|declare|enum)\b/.test(trimmed) &&
      // Allow continuation lines (members of an interface, etc.)
      !/^[}\])>;|,&]/.test(trimmed) &&
      !/^[A-Za-z_$][\w$?]*\s*[:?]/.test(trimmed) && // member declarations
      !/^[\s|&]+/.test(line) // union/intersection continuations
    ) {
      return false
    }
  }
  return true
}

// ── TS → JS via the TypeScript compiler ────────────────────────────

function tsToJsTranspile(source) {
  try {
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        removeComments: false,
        preserveConstEnums: true,
        isolatedModules: false,
        jsx: ts.JsxEmit.Preserve
      },
      reportDiagnostics: false
    })
    return result.outputText.replace(/\n+$/, '')
  } catch {
    return null
  }
}

// Regex fallback: strip the obvious annotations. Best-effort.
function tsToJsRegex(source) {
  let out = source
  // Drop "import type ... from '...'" lines (whole-line)
  out = out.replace(/^\s*import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  // Drop "import { type Foo, ... }" — leave the value imports.
  out = out.replace(/\btype\s+([A-Za-z_$][\w$]*)/g, '$1')
  // Drop "as Foo" type assertions (only "as <PascalIdent>" — heuristic).
  out = out.replace(/\s+as\s+[A-Z][\w$<>,[\]\s|&]*/g, '')
  // Drop generic args on call / new: foo<...>(  →  foo(
  out = out.replace(/<[\w$,\s|&<>[\]]+>(\s*\()/g, '$1')
  // Drop param/var type annotations: (x: Foo, y: Bar)  →  (x, y); let x: T = …
  out = out.replace(/(:\s*[A-Z][\w$.<>,[\]\s|&]*?)(?=\s*[,)=\]}])/g, '')
  // Drop return-type annotations on functions: ) : Foo {
  out = out.replace(/\)\s*:\s*[A-Z][\w$.<>,[\]\s|&]*(\s*[{=>])/g, ')$1')
  // Drop `implements X, Y` clauses on class declarations
  out = out.replace(/\s+implements\s+[A-Z][\w$.<>,[\]\s|&]*(?=\s*\{)/g, '')
  // Drop access modifiers + readonly on class fields/params
  out = out.replace(/\b(public|private|protected|readonly)\s+/g, '')
  // Drop standalone "override" keyword
  out = out.replace(/\boverride\s+/g, '')
  return out
}

function tsToJs(source) {
  // Try compiler first; only fall back to regex if it returns nothing useful
  // (e.g. empty output for type-only sources, or null on parse failure).
  const compiled = tsToJsTranspile(source)
  if (compiled !== null && compiled.trim().length > 0) return compiled
  return tsToJsRegex(source).trim()
}

function jsToTs(source) {
  // JS is generally valid TS; duplicate verbatim. Future work could sprinkle
  // optional type hints, but that's much harder to do well.
  return source
}

// ── JSDoc skeleton for type-only blocks ─────────────────────────────

function typeOnlyToJsdoc(source) {
  // Wrap the TS source in a comment block so the rendered JS pane is at least
  // pedagogically useful (vs an empty block). The header notes that the runtime
  // shape is identical between TS and JS — there's nothing to strip.
  const indented = source
    .split('\n')
    .map((l) => ' * ' + l)
    .join('\n')
  return `/**\n * Types are a TypeScript-only artifact — no JS runtime equivalent.\n * The contract below is duck-typed at runtime.\n *\n${indented}\n */`
}

// ── Adjacency check ────────────────────────────────────────────────

function isPairedAdjacent(blocks, i) {
  const cur = blocks[i]
  const next = blocks[i + 1]
  if (!next) return false
  if (!isLanguageBlock(cur.lang) || !isLanguageBlock(next.lang)) return false
  // Different language → potential pair
  const curIsTs = isTs(cur.lang)
  const nextIsTs = isTs(next.lang)
  if (curIsTs === nextIsTs) return false
  const curMeta = parseMeta(cur.meta)
  const nextMeta = parseMeta(next.meta)
  const curBase = baseFile(curMeta.file)
  const nextBase = baseFile(nextMeta.file)
  return curBase && nextBase && curBase === nextBase
}

// Same idea but looking backward (block i is the second of a pair).
function hasPairedPrev(blocks, i) {
  if (i === 0) return false
  return isPairedAdjacent(blocks, i - 1)
}

// ── Guide processing ───────────────────────────────────────────────

function listGuides() {
  return readdirSync(GUIDES_DIR, { recursive: true })
    .filter((f) => f.endsWith('.md') && basename(f) !== 'index.md')
    .sort()
}

function guideSlug(filename) {
  return basename(filename).replace(/\.md$/, '')
}

function processGuide(filename) {
  const filePath = join(GUIDES_DIR, filename)
  const source = readFileSync(filePath, 'utf8')
  const blocks = parseBlocks(source)

  const tasks = [] // { block, idx, lang, generatedSibling }
  let ordinal = 0
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (!isLanguageBlock(b.lang)) continue
    if (isPairedAdjacent(blocks, i)) {
      // Skip both halves of an existing pair.
      i += 1
      continue
    }
    if (hasPairedPrev(blocks, i)) continue
    ordinal += 1
    tasks.push({ block: b, idx: i, ordinal })
  }

  return { filePath, source, blocks, tasks, slug: guideSlug(filename) }
}

function renderFence(lang, meta, body) {
  return '```' + lang + (meta ? ' ' + meta : '') + '\n' + body + '\n```'
}

function dualizeGuide({ filePath, source, tasks, slug }) {
  if (tasks.length === 0) return { filename: filePath, paired: 0, errored: 0 }

  const lines = source.split('\n')
  // Process tasks in reverse line order so insertions don't shift later
  // indices.
  const ordered = [...tasks].sort((a, b) => b.block.startLine - a.block.startLine)

  let paired = 0
  let errored = 0

  for (const task of ordered) {
    const b = task.block
    const cur = b
    const srcIsTs = isTs(cur.lang)
    const srcExt = srcIsTs ? 'ts' : 'js'
    const dstExt = srcIsTs ? 'js' : 'ts'

    // Synthesize file= for the source half if it doesn't already have one.
    const meta = parseMeta(cur.meta)
    let curFile = meta.file ? baseFile(meta.file) : null
    if (!curFile) {
      curFile = synthesizeFileMeta(cur.body, slug, task.ordinal, srcExt).replace(/\.(ts|js)$/, '')
    }
    const srcFile = `${curFile}.${srcExt}`
    const dstFile = `${curFile}.${dstExt}`

    // Build the sibling body.
    let dstBody
    let typeOnly = false
    if (srcIsTs) {
      if (isTypeOnly(cur.body)) {
        dstBody = typeOnlyToJsdoc(cur.body)
        typeOnly = true
      } else {
        dstBody = tsToJs(cur.body)
        if (!dstBody || dstBody.trim().length === 0) {
          dstBody = tsToJsRegex(cur.body).trim()
        }
        if (!dstBody || dstBody.trim().length === 0) {
          errored += 1
          continue
        }
      }
    } else {
      dstBody = jsToTs(cur.body)
    }

    // Replace the original fence with one carrying the new meta, plus the
    // sibling block immediately after.
    const newCurFence = renderFence(srcExt, `file=${srcFile}`, cur.body)
    const newDstFence = renderFence(dstExt, `file=${dstFile}`, dstBody)

    // Mutation: replace lines[startLine..endLine] with the two stacked fences
    // separated by a blank line.
    const replacement = (newCurFence + '\n\n' + newDstFence).split('\n')
    lines.splice(b.startLine, b.endLine - b.startLine + 1, ...replacement)

    paired += 1
    if (typeOnly) {
      // Still counted as paired — the JSDoc sibling is intentional output.
    }
  }

  const out = lines.join('\n')
  if (!CHECK && out !== source) {
    writeFileSync(filePath, out, 'utf8')
  }
  return { filename: filePath, paired, errored }
}

function checkGuide({ tasks }) {
  return tasks.length
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  const guides = listGuides().filter((g) => !ONLY_GUIDE || guideSlug(g) === ONLY_GUIDE)
  if (ONLY_GUIDE && guides.length === 0) {
    console.error(`No guide matched --guide=${ONLY_GUIDE}`)
    process.exit(2)
  }

  if (REPORT_PLACEHOLDERS) {
    // Reporting-only scan: list every js block whose body still carries the
    // auto-generated `typeOnlyToJsdoc` header. These are the candidates for
    // a hand-authored JSDoc @typedef upgrade (see docs/README.md).
    const placeholders = []
    for (const filename of guides) {
      const source = readFileSync(join(GUIDES_DIR, filename), 'utf8')
      const blocks = parseBlocks(source)
      for (const b of blocks) {
        if (!isJs(b.lang)) continue
        if (!isPlaceholderJsBody(b.body)) continue
        const meta = parseMeta(b.meta)
        placeholders.push({ guide: guideSlug(filename), file: meta.file ?? '(no file=)' })
      }
    }
    if (placeholders.length === 0) {
      console.log('✓ No auto-generated JS placeholders remain.')
      process.exit(0)
    }
    console.log('Auto-generated JS placeholders found (consider hand-authoring JSDoc @typedef):\n')
    for (const p of placeholders) console.log(`  ${p.guide}:${p.file}`)
    console.log(`\nTotal: ${placeholders.length} placeholder(s).`)
    console.log('See docs/README.md → "Manual overrides" for the workflow.')
    process.exit(0) // reporting-only; never fails the build
  }

  let totalPaired = 0
  let totalErrored = 0
  let totalUnpaired = 0
  const rows = []

  for (const filename of guides) {
    const processed = processGuide(filename)
    if (CHECK) {
      const n = checkGuide(processed)
      if (n > 0) rows.push({ guide: guideSlug(filename), unpaired: n })
      totalUnpaired += n
    } else {
      const res = dualizeGuide(processed)
      if (res.paired || res.errored) {
        rows.push({ guide: guideSlug(filename), paired: res.paired, errored: res.errored })
      }
      totalPaired += res.paired
      totalErrored += res.errored
    }
  }

  if (CHECK) {
    if (totalUnpaired === 0) {
      console.log('✓ No unpaired ts/js code blocks found.')
      process.exit(0)
    }
    console.log('Unpaired ts/js code blocks found:\n')
    for (const r of rows) console.log(`  ${r.guide}: ${r.unpaired}`)
    console.log(`\nTotal: ${totalUnpaired} unpaired block(s).`)
    console.log('Run `npm run docs:dualize` to auto-generate siblings.')
    process.exit(1)
  }

  console.log('Dualized:\n')
  for (const r of rows) {
    const err = r.errored ? ` (errored: ${r.errored})` : ''
    console.log(`  ${r.guide}: +${r.paired}${err}`)
  }
  console.log(`\nTotal: +${totalPaired} paired block(s) added.`)
  if (totalErrored > 0) {
    console.log(`${totalErrored} block(s) could not be transformed and were left unpaired.`)
  }
}

main()
