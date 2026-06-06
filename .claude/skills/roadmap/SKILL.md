---
name: roadmap
description: Invoke ONLY when the developer explicitly asks for the mcp-rune public Roadmap workflow (e.g. via `/roadmap`). Do NOT auto-trigger on issue / label / milestone keywords — during the current BREAKING-changes phase, most issues could plausibly be Roadmap-relevant and auto-firing would defeat the purpose of extracting this from AGENTS.md.
---

# Roadmap

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
