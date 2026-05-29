# Authoring framework guides

The 31 guides under [`docs/guides/`](./guides) are the user-facing
documentation for mcp-rune. They're consumed by
[mcp-rune-site](https://github.com/mcp-rune/mcp-rune-site) (which
vendors this repo as a git submodule) and rendered as the public docs.

This README covers **one convention** that's important enough to encode
in tooling: every concrete code example ships **both** a TypeScript
**and** a JavaScript variant, switched in place by a `CodeSnippet`
component on the site.

The site reads pairs straight from the markdown via a small remark
plugin ([`src/lib/remark-code-pairs.mjs`](https://github.com/mcp-rune/mcp-rune-site/blob/master/src/lib/remark-code-pairs.mjs)).
This document describes the upstream half: how to author the pairs,
how to keep them in sync, and how to verify a guide is fully paired
before opening a PR.

---

## The pairing convention

A "paired snippet" is two adjacent fenced code blocks tagged `ts` and
`js`, both carrying a `file=...` meta whose **base path** (extension
stripped) matches. The renderer collapses the two into a single
CodeSnippet on the site, with a segmented TS ⇄ JS switch in the header.

````markdown
```ts file=src/models/book.ts
import { BaseModel, string, integer } from '@mcp-rune/mcp-rune'

export class Book extends BaseModel {
  static attributes = {
    title: string().required(),
    duration_min: integer().range(30, 180)
  }
}
```

```js file=src/models/book.js
import { BaseModel, string, integer } from '@mcp-rune/mcp-rune'

export class Book extends BaseModel {
  static attributes = {
    title: string().required(),
    duration_min: integer().range(30, 180)
  }
}
```
````

Rendered side: one `<CodeSnippet file="src/models/book" />` element with
a `.ts` tab and a `.js` tab. The reader's language choice persists
across guides via `localStorage` under key `mcp-rune:lang`.

Adjacency matters: the two fences must be siblings in the markdown AST
(separated by at most a blank line). The `file=` base paths must match —
the extensions are how the renderer knows which pane is which.

### Module syntax

Both variants use **ESM** (`import` / `export`). The framework's
`package.json` declares `"type": "module"`, so this matches the runtime
contract. Don't translate the JS variant to CommonJS unless a specific
example is illustrating CJS interop.

The intended diff between TS and JS is **type annotations only** — same
imports, same module structure, same runtime logic. That's the
pedagogical contract: a reader who flips the switch sees exactly what
types buy them.

---

## When to pair (and when not to)

**Pair these fences:**

- ` ```ts ` / ` ```typescript `
- ` ```js ` / ` ```javascript `

…**when** the block contains a concrete, runnable example.

**Skip pairing** for everything else:

- `bash`, `sh`, `zsh`, `shell` — commands
- `json`, `yaml`, `toml` — config
- `output`, `console`, `text`, `txt`, `diff` — sample output
- `mermaid`, `sql`, `html`, `css`, `xml`, `md`, `markdown` — non-code
- Untagged blocks (` ``` ` with no language) — folder trees, ASCII art

These render as standard Shiki blocks on the site, no toggle.

**Edge case — type-only blocks** (only `interface` / `type` / `declare`
with no runtime tokens): pairing makes pedagogical sense because the
"what JS gives up" is exactly the point. The dualize tool emits a JSDoc
sibling automatically; if you're hand-authoring, write a short comment
block explaining that types are TS-only and runtime shape is duck-typed.

---

## Writing a pair by hand

Most pairs are short enough that hand-authoring is faster than running
the tool. Two rules:

1. **Match the `file=` base path exactly** between the two fences. The
   extension is what's allowed to differ.
2. **Match the runtime behaviour exactly**. If the JS variant drifts from
   the TS variant beyond type annotations, the toggle stops being
   honest.

### Naming the `file=` path

The site renders the path in the snippet header (`src/models/book.ts`
when TS is active; `src/models/book.js` when JS is). Choose paths that
look like real source files:

- Prefix with a directory hint based on the identifier:

  | Identifier ends in | Use directory      |
  | ------------------ | ------------------ |
  | `Tool`             | `src/tools/`       |
  | `Service`          | `src/services/`    |
  | `Adapter`          | `src/adapters/`    |
  | `Convention`       | `src/conventions/` |
  | `Strategy`         | `src/strategies/`  |
  | `Extension`        | `src/extensions/`  |
  | `Client`           | `src/clients/`     |
  | `App`              | `src/apps/`        |
  | `Prompt`           | `src/prompts/`     |
  | `Workflow`         | `src/workflows/`   |
  | `Model`            | `src/models/`      |
  | `Registry`         | `src/registries/`  |
  | _other_            | `src/`             |

- Convert the identifier to `kebab-case`: `BookCreateTool` → `book-create-tool`.
- Fall back to `examples/<guide-slug>-<NN>.{ts,js}` when there's no
  obvious identifier (rare).

The dualize tool follows exactly these rules — running it after hand-
authoring is safe and idempotent.

---

## The dualize tool

Two npm scripts manage paired snippets in bulk:

```bash
npm run docs:dualize    # apply: generate missing siblings, write in place
npm run docs:check      # dry-run: report unpaired blocks, exit 1 if any exist
```

Both delegate to [`docs/scripts/dualize.mjs`](./scripts/dualize.mjs).
The script uses TypeScript's own compiler (`ts.transpileModule`) to
strip type annotations, falling back to regex-based stripping for blocks
the compiler rejects (fragments, pseudocode).

### Flags

- `--check` — read-only; prints a per-guide count of unpaired blocks and
  exits 1 if any are found. Suitable for CI / pre-commit.
- `--guide=<slug>` — only process one guide. `<slug>` is the filename
  without `.md` (e.g. `--guide=api-config-guide`).
- _(no flags)_ — apply transformations in place. Idempotent: running it
  twice does nothing the second time.

### What the script does

For each fenced block in each guide:

1. **Already paired** (adjacent ts/js with matching `file=`) → skip.
2. **Skip-pair language** (bash/json/yaml/etc.) → skip.
3. **TS source, no sibling** → transpile to JS via `transpileModule`,
   synthesize `file=` for both halves, insert the JS sibling.
4. **JS source, no sibling** → duplicate as TS (JS is generally valid
   TS), synthesize `file=`, insert the TS sibling.
5. **Pure type-only TS block** → emit a JSDoc-style comment block as
   the JS sibling so the rendered pane is at least pedagogically useful.

The transformer is intentionally conservative — when the TS compiler
rejects a block (pseudocode, malformed fragment), the script falls back
to regex stripping. If even that fails, the block is left unpaired and
reported in the summary, so a human can hand-author it.

### When to run

- **After adding a new code example** to a guide. The tool will pair it
  for you.
- **After a CHANGELOG-worthy refactor of an existing block** (e.g.,
  rewriting an example to use a new API). Delete the existing JS half,
  edit the TS half, and re-run.
- **Before opening a PR** that touches docs. `npm run docs:check` should
  exit 0.

### Idempotency

Running `npm run docs:dualize` repeatedly is safe — once a block is
paired, the script leaves it alone. This means the typical flow is:

```bash
# write some TS examples in a guide…
npm run docs:dualize       # add missing JS siblings
npm run docs:check         # verify (should exit 0)
git add docs/ && git commit
```

---

## Pre-commit + CI integration

These are **opt-in** suggestions, not enabled by default — they're left
as a contributor choice.

### Pre-commit

Add `docs:check` to the existing `.husky/pre-commit` hook so a commit
that introduces unpaired blocks is blocked:

```bash
#!/usr/bin/env sh
npx lint-staged
npm run docs:check
```

Trade-off: the check is fast (~1 second) but does add to commit
latency. If you'd rather catch unpaired blocks only at PR time, leave
pre-commit alone and rely on CI.

### CI

Add a `npm run docs:check` step to your CI workflow:

```yaml
- name: Docs — TS/JS pair check
  run: npm run docs:check
```

The script exits 1 when unpaired blocks exist, failing the build with a
per-guide breakdown of where to fix.

---

## Troubleshooting

### "The script couldn't transpile this block"

The transformer falls back to regex stripping for blocks the TS compiler
rejects. If even regex fails, the block is left unpaired and reported in
the summary. Options:

1. **Hand-author the JS sibling** — usually fastest for fragments.
2. **Make the TS block standalone** — wrap it in a function or class so
   the compiler accepts it.
3. **Re-tag the block** as `text` or `json` if it isn't actually code
   (e.g., pseudocode showing structure).

### "The transpiled JS looks awkward"

`ts.transpileModule` is a reformatter as well as a type-stripper. It
normalizes some things (semicolons, single-line getters). For a polished
JS variant, hand-author the sibling — the tool's output is the baseline,
not the ceiling.

### "I changed the TS variant but the JS is stale"

The script doesn't touch already-paired blocks. To regenerate, delete
the JS sibling fence and re-run `npm run docs:dualize` — it'll pair the
TS again.

### "I want a CJS variant instead of ESM"

That's a deliberate exception to the convention. Hand-author both halves
and use a different `file=` extension pair (e.g., `book.ts` /
`book.cjs`). The renderer currently only recognises `.ts ↔ .js`, so the
CJS half won't render as a CodeSnippet — it'll fall through to standard
Shiki. Open an issue if you need first-class CJS support.

---

## How the site renders pairs

[mcp-rune-site](https://github.com/mcp-rune/mcp-rune-site)'s remark
plugin (`src/lib/remark-code-pairs.mjs`) walks the markdown AST. When it
finds two adjacent fence nodes with `lang ∈ {ts, typescript, js,
javascript}` and matching `file=` base paths, it replaces both with a
single HTML node containing the CodeSnippet wrapper, with each variant
pre-rendered through Shiki.

That node carries `data-code-snippet`; the runtime script
(`src/scripts/code-snippet.ts`) wires the tab clicks, persists the
language choice in `localStorage`, and broadcasts the choice across
every snippet on the page.

Look there first when rendering surprises happen.
