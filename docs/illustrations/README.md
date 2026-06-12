# Illustrations

Polished SVG redraws of the ASCII diagrams in `docs/guides/`. The ASCII stays authoritative for everyone reading the guides raw — terminal, nvim, GitHub, the framework's own readers — while the public site (`mcp-rune-site`) substitutes the matching `.svg` in its place at build time. Nothing about this pipeline runs in a user's browser; everything is precomputed.

---

## Directory layout

```
docs/illustrations/
  README.md                 ← this file
  illus.mjs                 ← shared SVG DSL: colours, fonts, primitives
  pages/<slug>.mjs          ← authoring source, one per guide
  svgs/<slug>--<fig>.svg    ← built artifacts the site consumes (commit them)
  preview/index.html        ← open in a browser for a side-by-side gallery
  scripts/
    build-illustrations.mjs ← imports pages/*.mjs, writes svgs/*.svg
    check-illustrations.mjs ← drift check: rebuild → tmp → diff
```

`illus.mjs`, `pages/`, and `svgs/` are the three layers that matter. Everything else is convenience.

---

## How a guide picks up its illustration

In a guide markdown file, put an HTML comment immediately above the ASCII fenced block:

    <!-- illustration: quickstart#fan -->
    ```
    [ ASCII diagram here ]
    ```

The marker id is `<slug>` (or `<slug>#<fig>` when a page exports more than one figure). The site's remark plugin (`mcp-rune-site/src/lib/remark-illustrations.mjs`) resolves the marker to `svgs/<slug>--<fig>.svg` and inlines that file inside a `<figure>` wrapper. The original ASCII fence is dropped from the rendered output — the SVG's `aria-label` covers screen-readers, and the source `.md` keeps the ASCII unchanged for everyone reading off-site.

HTML comments are invisible in every Markdown reader that matters (GitHub, nvim preview, terminal cats), so adding the marker does not pollute the guide's appearance off-site.

### Soft-failure model

- Missing svg → site logs a warning and renders the ASCII unchanged.
- Marker malformed → ignored; ASCII renders.
- Marker absent → ASCII renders.

**The build never fails over an illustration issue.** The worst outcome is "the polished version didn't show up", which the original ASCII already covers gracefully.

---

## Iterate on an existing illustration

1. Edit `pages/<slug>.mjs`.
2. `npm run illustrations:build` — rewrites `svgs/<slug>--<fig>.svg`.
3. Open `svgs/<slug>--<fig>.svg` in a browser to eyeball the result, or open `preview/index.html` for the full gallery.
4. Commit the `.mjs` and the `.svg` together. Both diffs are human-readable.

---

## Add a new illustration

1. Create `pages/<slug>.mjs`. The skeleton — every variable is named and defined inline, no IIFEs, no hidden state:

   ```js
   // pages/<slug>.mjs
   import { colors, text, rect, line, svg } from '../illus.mjs'

   // Build the main figure for this guide.
   function buildMainFigure() {
     // Canvas size. Start at 720x320 and grow if the content needs it.
     const width = 720
     const height = 320

     // Compose the SVG body as a string of helper outputs.
     let body = ''
     body += text(40, 36, 'TITLE OF DIAGRAM', {
       size: 11,
       letterSpacing: '0.1em',
       fill: colors.accentSoft
     })
     body += rect(40, 60, width - 80, 200, {
       radius: 11,
       fill: colors.panel,
       stroke: colors.panelStroke
     })
     // … add text() for labels, rect() for sub-panels, line() for
     // connectors. One call per visual element; no loops needed.

     const altText = '… one-sentence screen-reader description …'

     // Wrap body in the framed <svg> root.
     const rendered = svg(width, height, 'CAPTION', body, { alt: altText })
     return { svg: rendered, alt: altText }
   }

   // Export each figure by short id. The build script writes
   // ../svgs/<slug>--main.svg from this export.
   export const main = buildMainFigure()
   ```

2. `npm run illustrations:build`.
3. Add `<!-- illustration: <slug>#main -->` above the ASCII fence in the guide.
4. Commit all three: `pages/<slug>.mjs`, `svgs/<slug>--main.svg`, and the edited guide.

If the page has only one figure, also `export default main;` so the short marker `<!-- illustration: <slug> -->` (no `#fig`) resolves to the same SVG.

---

## Restyle every illustration at once

Edit `illus.mjs` — tweak a colour token in `colors`, a default font size in the `text` helper, the default stroke in `rect`, etc. Re-run `npm run illustrations:build` and every `.svg` is regenerated. This is the right escape hatch for theme refreshes; no per-page work needed.

---

## Authoring reference — `illus.mjs` primitives

All coordinates are in SVG user units, origin top-left.

| Function | Draws |
| --- | --- |
| `text(x, y, string, options)` | A text label. Options: `size`, `fill`, `letterSpacing`, `anchor`, `weight`. |
| `rect(x, y, width, height, options)` | A rounded panel or accent bar. Options: `radius`, `fill`, `stroke`, `strokeWidth`, `dash`. |
| `line(x1, y1, x2, y2, options)` | A connector line. Options: `stroke`, `strokeWidth`, `dash`. |
| `arrowRight(x1, y, x2, options)` | Horizontal arrow with a tip glyph. |
| `arrowDown(x, y1, y2, options)` | Vertical arrow with a tip glyph. |
| `band(x, y, width, height, label, options)` | Labelled container with a small dot, used for layer headings. |
| `panel(x, y, width, height, title, options)` | Titled sub-panel inside a band. |
| `verticalConnector(x, y1, y2, label, options)` | Vertical line with a centred pill label between two stacked elements. |
| `svg(width, height, caption, body, { alt })` | Wraps a built body string in the framed `<svg>` root. **Use this last.** |
| `colorizeTree(asciiString)` | Convert an ASCII directory tree into a coloured `<div class="tree">…</div>`. Used by tree archetype. |
| `colors.*` | Theme colour tokens. Never hardcode hex values. |

Available `colors.*` tokens (full list lives in `illus.mjs`): `frame`, `frameStroke`, `panel`, `panelStroke`, `panelHead`, `band`, `ink`, `inkSoft`, `inkMuted`, `inkDim`, `inkFaint`, `accent`, `accentSoft`, `accentDeep`, `teal`, `tealDeep`, `amber`, `blue`, `aqua`, `rose`, `line`, `lineSoft`, `lineMid`.

### Visual archetypes — pick one per figure

Consistency across the gallery is more valuable than per-page creativity. Reach for the archetype that already exists rather than inventing a new layout.

| Archetype | When to use it | Pilot examples |
| --- | --- | --- |
| **layered** | Vertical stack of horizontal bands; data flows top-to-bottom or bottom-to-top through layers. | `data-layer`, `mcp-apps-architecture`, `prompt-derivation-framework` |
| **fan-out** | One source on the left, many derived outputs on the right. | `quickstart`, `attribute-kinds` |
| **funnel** | Many inputs converge to fewer outputs. | `service-layer`, `tool-creation` |
| **chain** | Sequential steps, left-to-right, each transforms the previous. | `api-config`, `service-layer` |
| **pipeline** | Like chain, but with interceptor / hook points along the way. | `tool-creation`, `mcp-apps-guide`, `api-client` |
| **tree** | Directory / category hierarchy. Use `colorizeTree` instead of hand-laying boxes. | `project-structure`, `mcp-apps-architecture`, `custom-app` |
| **lifecycle** | Cyclic or session-shaped state diagram with phases. | `analysis-memories`, `transient-context-protocol` |
| **escalation** | Tiered progression (simple → mid → advanced) with explicit thresholds. | `prompt-creation`, `extensibility-overview` |
| **mapping** | Two parallel columns with arrows showing which item on the left maps to which on the right. | `sections-groups`, `search-filter-integration`, `extension-recipes` |

---

## Asking an AI assistant to update or add an illustration

These templates are deliberately explicit about constraints. Paste them as-is and fill in the angle-bracketed slots; do not relax the constraints to "make the AI's life easier" — they are what keep the gallery coherent.

### Template: update an existing figure

> Update `docs/illustrations/pages/<slug>.mjs`, figure `<fig-id>`. Change: **\<one-sentence change\>**. Constraints:
>
> - Reuse the `illus.mjs` primitives (`text`, `rect`, `line`, `arrowRight`, `arrowDown`, `band`, `panel`, `verticalConnector`, `svg`, `colorizeTree`). Do not introduce raw `<svg>` markup or new helper functions.
> - Use only `colors.*` tokens for fills and strokes; never hardcode a hex.
> - Keep the existing canvas `width` and `height` unless the change demands more space; if it does, grow `height` first, then `width`.
> - Keep the existing archetype (layered / fan-out / funnel / chain / pipeline / tree / lifecycle / escalation / mapping).
> - Update the figure's `altText` to reflect the change.
>
> Then run `npm run illustrations:build`, confirm only `svgs/<slug>--<fig-id>.svg` changed in the diff, open that file in a browser to eyeball the result, and report the new viewBox.

### Template: add a new figure

> Add a new figure `<fig-id>` to `docs/illustrations/pages/<slug>.mjs` that illustrates: **\<one-sentence description\>**. Archetype: **\<one of: layered, fan-out, funnel, chain, pipeline, tree, lifecycle, escalation, mapping\>**.
>
> Use only `illus.mjs` primitives and `colors.*` tokens. Wrap the figure in a named `function build<FigId>Figure()` and `export const <fig-id> = build<FigId>Figure();` — no IIFEs, no implicit state. Provide an `altText` string describing the diagram as you would for a screen reader.
>
> Then run `npm run illustrations:build`, add `<!-- illustration: <slug>#<fig-id> -->` directly above the corresponding ASCII fence in `docs/guides/<slug>-guide.md`, and report the three files touched (`pages/<slug>.mjs`, `svgs/<slug>--<fig-id>.svg`, the guide).

### Template: restyle the whole gallery

> Edit `docs/illustrations/illus.mjs`. Change: **\<one-sentence theme change, e.g. "shift the panel background from `#14141e` to `#161622`"\>**.
>
> Update only the `colors` token(s) involved; do not touch any `pages/*.mjs` file. Then run `npm run illustrations:build` and confirm every `.svg` in `svgs/` has changed in the expected dimension only (no layout shifts).

### What NOT to ask the assistant for

- **Raw `<svg>` markup** — always go through `illus.mjs`. If a primitive is missing, add it to `illus.mjs` (with a test), do not inline `<svg>` in a page module.
- **Hex colours or named fonts spelled out** — always use `colors.*`.
- **Compact IIFEs** like `export const x = (() => { … })()` — use a named `build…Figure()` function and export the call result. Reasoning: the named-function form is the project standard because it reads cleanly top-to-bottom.
- **Single-letter or abbreviated identifiers** in new code — the pilot used `T`, `R`, `L`, `C` because it ran inline inside HTML `<script>` blocks where byte count mattered. The module API is descriptive on purpose.
- **Removing the ASCII fence in the guide** — the ASCII is authoritative for off-site readers. It always stays in the markdown.
- **A new archetype** unless every existing one has been considered and rejected with reasoning. Ad-hoc layouts erode gallery coherence faster than they help any one page.

---

## Build pipeline & CI

### `npm run illustrations:build`

Imports every `pages/*.mjs` via plain Node `import()`, writes each exported figure's `svg` field to `svgs/<slug>[--<fig>].svg`. Pure Node — no `jsdom`, no browser, no Astro. Finishes in well under a second for the whole gallery.

### `npm run illustrations:check`

Same build, but into a temporary directory; then byte-compares against the committed `svgs/`. Non-zero exit means "someone edited a page without rebuilding." Run in CI and as part of the site's `scripts/sync-mcp-rune.sh` so a stale svg never reaches the public site.

### Site-side integration (in `mcp-rune-site`)

- `src/lib/remark-illustrations.mjs` — remark plugin. Walks the mdast, finds `<!-- illustration: id -->` comments adjacent to fenced code blocks, reads the matching file from `vendor/mcp-rune/docs/illustrations/svgs/`, and replaces the pair with a single `<figure>` html node wrapping just the SVG. The original ASCII fence is dropped from the rendered output.
- `astro.config.mjs` — registers the plugin alongside `remarkCodePairs`.
- `src/styles/illustrations.css` — figure / details styling (small subset extracted from this directory's design tokens; the standalone-page chrome in the pilot's `ds.css` is not shipped).

---

## Design rationale — why this shape, and not another

These choices were taken deliberately and have load-bearing consequences. Revisit them before changing them.

- **Why marker comments and not content-hash matching?** Explicit author intent. A marker is grep-able, debuggable ("does this `.svg` exist?"), and disambiguates near-identical ASCII blocks. Content hashing would silently bypass an illustration the moment the ASCII changed by one space.
- **Why `.mjs` source → `.svg` artifact, not a manifest?** The filesystem is the manifest. Each `.svg` file is independently inspectable, diffable in PRs, openable in a browser. No second representation to keep in sync.
- **Why no `jsdom`?** `jsdom` execution timing, font resolution, network loading, and JS-rendered-vs-static-page divergence are classic build flakiness sources. The DSL produces SVG as plain strings; we never need a DOM.
- **Why descriptive function names (`text`, `rect`, `colors`) instead of the pilot's `T`, `R`, `C`?** The pilot's terseness was a constraint of inline `<script>` blocks where byte count mattered. Once the code lives in a module that contributors import by name, descriptive identifiers pay back every read.
- **Why the ASCII stays in markdown?** It is the source of truth for every reader who is not on the public site: terminal, nvim, GitHub, the framework's own readers. Removing it would degrade the off-site reading experience to "go look at our website."
- **Why the ASCII is dropped from the rendered site output (no `<details>` fallback)?** The earlier design kept a collapsed "ASCII" toggle below each figure as a copy-paste + screen-reader affordance. In practice it was visual noise — the SVG's `aria-label` already describes the diagram for screen-readers, and the source `.md` keeps the ASCII for anyone reading off-site. The site renders the SVG only, no toggle.
- **Why soft-failure (warn, never error)?** The illustration is an enhancement, not a requirement. A missing or broken illustration must never block a guide from rendering.
