# Designs

Committed exports of [claude.ai/design](https://claude.ai/design) bundles that drive the MCP apps in `src/mcp/apps/`. This folder is the **reference input** for app work — it is _not_ shipped to npm and is _not_ built. Designs live here so the agent (and reviewers) can read every design locally and reason over all of them at once, instead of fetching one design URL at a time.

## Why exports live in the repo (the interim mechanism)

The obvious alternative is to hand the agent a design URL each time:

```
Fetch this design file, read its readme, and implement the relevant aspects of the design.
https://api.anthropic.com/v1/design/h/…?open_file=MCP+apps+v3.html
```

We deliberately **don't** do that. That remote-fetch handoff has three problems:

1. **It often fails.** Claude Design share URLs return _not found_ to an unauthenticated Claude Code client — see [anthropics/claude-code#52292](https://github.com/anthropics/claude-code/issues/52292).
2. **It's one design at a time.** Each prompt pulls a single file; the agent can never compare or reason over the whole set of designs.
3. **Nothing persists.** No file on disk means no diff, no review, no history, no reproducibility.

The robust long-term fix would be for Claude Code to query a live design system over MCP (`get_design_system(version)`, `list_artifacts`, a change feed, …). That is still only an **open feature request** — [anthropics/claude-code#60327](https://github.com/anthropics/claude-code/issues/60327), `area:mcp` / `area:integrations`, no maintainer commitment yet. Until it ships, the community-recommended pattern — and the one this repo follows — is the escape hatch named in that very issue: **export the design to a known path in the repo and treat the committed copy as authoritative.**

### What that costs us: drift

A committed export is a **snapshot, not a live link.** The moment the designer iterates in claude.ai/design, the copy here is stale. We accept that and make staleness _visible_ instead of silent: every export is registered in [`manifest.json`](./manifest.json) with its `source` URL, `version`, and `exportedAt` date. When the design changes, re-export, bump `version` + `exportedAt`, and commit. The manifest is the single source of truth for "which snapshot of which design are we on, and which app does it drive."

## Layout

```
designs/
  README.md              ← you are here (the canonical workflow doc)
  manifest.json          ← single source of truth: one entry per design
  manifest.schema.json   ← JSON Schema for manifest.json (ajv)
  scripts/
    validate-designs.mjs ← `npm run designs:check`
  <slug>/                ← one folder per exported design (the unzipped bundle)
```

## Adding or updating a design

1. **Export from claude.ai/design.** Open the design, `Export → ZIP` (or "Export to Claude Code"). An agent _cannot_ do this step — the share URL is unauthenticated-blocked (#52292), which is the whole reason exports are committed.
2. **Unzip into `designs/<slug>/`.** Use a kebab-case slug, e.g. `designs/mcp-apps-v3/`.
3. **Register it in [`manifest.json`](./manifest.json).** Add an entry (see the example below). Fill in `source` (the design URL), `version`, `exportedAt` (today, `YYYY-MM-DD`), the `files` that matter, and the `implements` app slugs under `src/mcp/apps/`.
4. **Validate + commit.** Run `npm run designs:check` (it also runs inside `npm run verify:release` and CI). Stage with `git add -A` and commit.

### Example entry

```json
{
  "designs": [
    {
      "slug": "mcp-apps-v3",
      "name": "MCP apps v3",
      "source": "https://api.anthropic.com/v1/design/h/BKoPFIcFuhphakOeVS7dFA",
      "version": "v3",
      "exportedAt": "2026-06-16",
      "files": ["MCP apps v3.html"],
      "implements": ["find-model-app", "pick-model-app", "multi-pick-model-app"],
      "notes": "Visual restyle; tokens map to src/mcp/apps/shared/base.css."
    }
  ]
}
```

## Implementing from a committed design

Use this prompt instead of the old URL-fetch one — it reads local files, no network:

> Read `designs/manifest.json`, then the bundle under `designs/<slug>/`, and implement the relevant app(s) at `src/mcp/apps/<app>/ui/`. Map design tokens to `src/mcp/apps/shared/base.css`.

### What NOT to ask

- **Don't** paste `api.anthropic.com/v1/design/…` fetch prompts. The agent reads `designs/`, not the network.
- **Don't** treat a committed export as the live design. If it looks stale, re-export (step 1) before implementing — don't guess the delta.
- **Don't** edit files inside `designs/<slug>/` by hand. They are exact exports; hand-edits make the snapshot lie about its `source`. Iterate in claude.ai/design and re-export.

## Enforcement

`npm run designs:check` ([`scripts/validate-designs.mjs`](./scripts/validate-designs.mjs)) is wired into `verify:release` and CI (the same gate discipline as `docs:stamp:check`). It fails the build when:

- `manifest.json` doesn't match `manifest.schema.json`;
- a `designs/<slug>/` folder has no manifest entry, or a manifest entry has no folder;
- a file listed in an entry's `files` is missing on disk;
- an entry's `implements` names an app that doesn't exist under `src/mcp/apps/`.

So the manifest can't silently drift from what's actually committed.
