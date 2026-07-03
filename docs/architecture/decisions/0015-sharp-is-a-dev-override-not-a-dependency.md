# 0015. `sharp` is a dev-only override, not a shipped dependency; drop the `./lib/*` wildcard export

- Status: Accepted
- Date: 2026-07-03
- Related: #348, [ADR-0001](0001-llm-synthesis-stays-client-side.md)

## Context

Two packaging defects gave every npm consumer a broken install surface.

**`sharp`.** The framework uses only the text-embedding path of the optional `@huggingface/transformers` backend; `sharp` (a ~30 MB native image library) is a transitive dependency of transformers' image pipelines, dead weight here. The repo vendors a no-op `sharp` stub and points npm at it — the correct mechanism is `overrides`, which the stub's own README documents. But `sharp` was **also** declared as a direct `dependency` (`"sharp": "file:./vendor/sharp-noop"`), and `vendor/` is excluded from the published tarball. So every consumer of `@mcp-rune/mcp-rune` got `node_modules/sharp` symlinked to a path that does not exist in the installed package — a dangling symlink, reproduced in a clean install.

**`./lib/*`.** The exports map otherwise curates a layer-respecting public API (`./data-layer`, `./oauth2`, `./tools`, …), but a catch-all `"./lib/*": "./dist/*"` re-opened every compiled internal module, letting a deployer import past the three layers and making the seams non-authoritative. Nothing in-repo referenced it.

## Decision

- **`sharp` moves from `dependencies` to `overrides`.** It is dev-local dependency-tree surgery, not a package the framework depends on. mcp-rune's own install resolves `sharp` to the vendored no-op (skipping the native build); the stub stays unpublished (correct — `overrides` with a `file:` path is meaningful only in the root install). A consumer who adds the optional transformers backend gets `sharp` through transformers and manages it themselves (real install, or their own override), exactly as npm's override semantics require — a dependency cannot force an override on its consumers.
- **The `./lib/*` wildcard export is deleted.** The public surface is the curated named subpaths only. Anything a deployer legitimately needs gets an explicit, layer-respecting entry.

## Options considered

**Ship the stub (add `vendor/sharp-noop` to `files`) — rejected.** It makes the direct-dependency symlink resolve, but keeps `sharp` as a declared dependency of a package that does not use it, and ships a stub that can never override anything in a consumer's tree (override semantics are root-only). It treats the symptom, not the miscategorization.

**Move `sharp` to `optionalDependencies` — rejected.** Still declares a dependency the framework does not use, and an optional `file:` dep is installed by default (optional means "don't fail if unavailable," not "skip"), so the unshipped-stub symlink problem persists.

**Keep `./lib/*` but document it as an escape hatch — rejected.** An escape hatch that re-opens every internal is the absence of a boundary; the layer discipline the eslint guard enforces internally would have a public bypass.

## Consequences

- BREAKING: any consumer importing `@mcp-rune/mcp-rune/lib/...` must move to a named subpath (none known; not referenced in-repo or in the downstream forks).
- Clean installs no longer carry a dangling `sharp` symlink.
- mcp-rune's own `npm ci` stays light (no native `sharp` build) via the override.
- The stub README already described the override design; the stray direct dependency was the bug, now removed.
