# AGENTS.md

## Design Principles

- **Never design for backward compatibility.** When introducing a new pattern, apply it fully. Remove the old code path — do not keep fallback branches, shims, or deprecated re-exports. One way to do things, not two.
- **No speculative abstractions.** Only add complexity the task actually requires.
- **Delete, don't deprecate.** If something is replaced, remove it. No `@deprecated` aliases, no `// legacy fallback` branches, no re-exports of old names.
- **Tool responses stay concise.** Return a short summary string or a small JSON envelope. Never return per-record arrays from batch / bulk tools — sample errors or a count summary is enough. The LLM should never have to scroll a tool response. Full per-record results belong in the server log, not the context window.
- **No banner-comment section dividers.** Do not add `// ====…` separators (or `// ---` block dividers, or boxed `/** ===== Foo ===== */` headers) to chunk a file into "Types / Errors / Public API / Internals" sections. If a file is long enough that you feel the urge to add them, the file is doing too much — split it, collapse the grouping, or trust the reader to follow the symbol names. Whitespace + a one-line JSDoc on the symbol itself is enough.

## Roadmap

This repo's milestones + tagged issues feed the public Roadmap at https://mcp-rune.dev/roadmap. The site (`mcp-rune-site`) fetches at build time; full label/milestone conventions live in `mcp-rune-site/AGENTS.md` under "Roadmap page is GitHub-driven at build time". The rules below are the operating discipline on this side of the seam.

**Current open milestone**: `future` — no in-flight theme. Researching items live here until a theme converges enough to become its own open milestone.

When opening a new issue:

1. **Decide if it's a Roadmap headline.** The Roadmap is curated, not a backlog mirror. Most issues stay non-Roadmap — they use only the existing scoped labels (`mcp:apps`, `infra:ci`, `dx:testing`, etc.) and do not get an `area:*` label. Only add a Roadmap signal if this issue represents a _theme-level_ piece of work worth surfacing publicly.
2. **If Roadmap-bound**: add an `area:*` label (one of `apps`, `core`, `tools`, `prompts`, `extensions`, `transport`, `auth`, `docs` — extend the seed set if a new theme genuinely doesn't fit) AND a `status:*` label (usually `status:planned` or `status:researching` at creation time).
3. **Pick a milestone**: assign to the current open theme milestone if it fits, otherwise to `future`. Don't assign to a closed milestone — closed means "shipped"; new work goes to whatever's open.
4. **Don't apply `shipped-in:<version>` at creation.** That label records where the work actually landed; only add it on close.

When closing/merging an issue:

- Flip `status:planned` or `status:in-progress` → `status:shipped`.
- Add the matching `shipped-in:<version>` label (create the label on demand if the version's label doesn't exist yet — color `#0E8A16` to match the existing pattern).

When a new theme converges:

- Create a milestone titled after the theme (not a version), e.g. `Auth & sessions hardening`. If you want the Roadmap to show a separate headline + blurb, end the first line of the description with `…` or `...` (the site treats that line as the name, ellipsis stripped).
- Move the in-flight `status:planned` / `status:in-progress` issues into the new milestone.
- Update the **Current open milestone** line above so the next agent knows where new issues default to.

**Keep the existing `mcp:*` / `infra:*` / `dx:*` / `api:*` / `core:*` / `server:*` / `lib:*` labels in use** for all issues regardless of Roadmap status — they're the primary taxonomy for triage and historical search. The `area:*` labels are an additional, narrower signal that only Roadmap-bound issues carry.
