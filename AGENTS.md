# AGENTS.md

## Layer discipline

mcp-rune's projection layer — everything under `src/mcp/apps/`, `src/mcp/tools/`, `src/mcp/prompts/`, and `src/mcp/data-layer/api-extensions/` — reaches model machinery, analysis machinery, and the backend exclusively through three peer interfaces. **Never bypass these interfaces by importing internal helpers directly.** If a method you need doesn't exist on the relevant interface, **extend the interface** rather than reaching past it.

### `DataLayer` — backend I/O

Constructed per authenticated request. Apps get it as `context.dataLayer`; tools get it as `this.dataLayer` (from `ToolDependencies.dataLayer`). The interface lives at `src/mcp/data-layer/data-layer.ts`.

Never import `ApiClient`, `ModelService`, `searchClient`, `SearchService`, `EndpointResolver`, or any concrete adapter from a projection-layer file. Use `dataLayer.find`, `dataLayer.list`, `dataLayer.searchNormalized`, `dataLayer.dispatch`, etc.

### `ModelLayer` — per-model-bound model-config reads

Synchronous, stateless, cached per model class. Bound to a single model at construction. Apps get it as `context.modelLayer(name)`; tools as `this.modelLayer?.(name)`. The interface lives at `src/mcp/model-layer/model-layer.ts`.

Surface: `kindFor(attrName)`, `resolveDerivedFields(records)`, `validFieldNames()`, `promptSchema(options?)`, `checkRequired(params)`.

Never import `resolveDerivedFields`, `collectValidFieldNames`, `derivePromptSchema`, `deriveFieldDefinitions`, `validateRequired`, `validateEnum`, `validateUrl`, or `getKind` from `src/mcp/model-layer/*` or `src/mcp/models/kinds/` in a projection-layer file.

### `AnalysisLayer` — per-model-bound, per-request analysis projections

Carries the authenticated `DataLayer` for I/O-bearing methods. Apps get it as `context.analysisLayer(name)`; tools as `this.analysisLayer?.(name)`. The interface lives at `src/mcp/analysis-layer/analysis-layer.ts`.

Surface today: `extractEdges(record, options?)`, `buildEmbeddingText(record, options?)`. Designed to host `walkHops`, `summarize`, and `buildStratifier` in follow-up releases.

Never import `extractEdgesFromRecord`, `buildEmbeddingText`, `expandHops`, or anything from `graph-stratifiers.ts` / `multi-hop-fetch.ts` in a projection-layer file.

### Enforcement

The rules above are enforced by a `no-restricted-imports` block in `eslint.config.js`, scoped to `src/mcp/apps/**`, `src/mcp/tools/**`, `src/mcp/prompts/**`, and `src/mcp/data-layer/api-extensions/**`. Boot-time validators (`src/mcp/apps/lib/form-validator.ts` and `src/mcp/prompts/prompt-validator.ts`) are exempt because they run before any factory is constructed; any new boot-time validator that needs a helper directly should be added to the exemption list rather than left to break the build.

### Layers vs adapters

A **layer** implies a projection/computation over _local_ definitions — e.g., `ModelLayer` derives a schema from model classes; `AnalysisLayer` builds embedding text from record fields. A layer presupposes local config to process.

**When the storage backend may have no local config at all** (items come purely from a database), use the **adapter** pattern instead: name the interface `*Adapter`, nest it in the relevant module's own `adapters/` folder, and export it from the module's public entry point. Do not create a sibling `*-layer/` folder.

Example: domain knowledge uses `DomainAdapter` (`src/mcp/domain/adapters/`) rather than a `domain-layer/` folder, because a remote adapter (PGVector, Qdrant) has nothing local to project.

### Definitions files — one per module

Each module that owns value-object classes ships a companion `*-definitions.ts` file with **pure TypeScript interfaces and types only** — no runtime code. The pattern:

| Module             | Definitions file        | Layer / adapter            |
| ------------------ | ----------------------- | -------------------------- |
| `src/mcp/models/`  | `model-definitions.ts`  | `src/mcp/model-layer/`     |
| `src/mcp/prompts/` | `prompt-definitions.ts` | —                          |
| `src/mcp/domain/`  | `domain-definitions.ts` | `src/mcp/domain/adapters/` |

The definitions file is the shared vocabulary. Runtime classes import types from it; projection-layer code (tools, apps) imports only the types it needs via the module's public entry point.

### Folder layout that supports the rule

The layers sit at the same depth under `src/mcp/`, separated from the **declarative** side:

- `src/mcp/data-layer/` — backend I/O seam
- `src/mcp/model-layer/` — generic, per-model-bound model-config consumers
- `src/mcp/analysis-layer/` — analysis-domain consumers
- `src/mcp/models/` — **what a model IS**: `base-model.ts`, `model-definitions.ts`, and the `kinds/` registry. _Never_ dump helpers that consume a model into this folder; they belong in `model-layer/` or `analysis-layer/`.
- `src/mcp/prompts/` — both **what a prompt IS** (`base-prompt.ts`, `prompt-definitions.ts`, …) and the prompt-runtime consumers (`prompt-registry.ts`, …). One folder because the runtime side is not per-model-bound the way `model-layer/` is.
- `src/mcp/domain/` — **what domain knowledge IS**: `DomainConcept`, `BusinessRule`, `WorkflowDefinition`, `domain-definitions.ts`. Also contains `adapters/` (`DomainAdapter` interface + `InMemoryDomainAdapter`) and `registry.ts` (`DomainRegistry`, which wraps a `DomainAdapter`).

When introducing a new seam, first ask: does this involve projecting _local_ definitions (→ layer + sibling folder), or providing a swappable storage backend (→ adapter + `adapters/` subfolder inside the existing module)?

## Seams must be self-documenting

When you add a deployer-facing capability to a public seam (a new `DataLayerFactoryContext` option, a `ToolRegistry`/`AppRegistry` config field, an analogous knob on a future layer), the customization path must be visible _from the seam file itself_, end-to-end. A field added only to an internal config interface, or only to an adapter constructor, is not "exposed" — a reader walking `src/mcp/data-layer/data-layer.ts` (or the equivalent seam file) must be able to see how a deployer would set it without chasing references into private files.

Concrete rules:

- **Trace the path end-to-end before declaring the seam complete.** Every hop must be readable at its file: `Registry config → FactoryContext → Adapter constructor → instance field`.
- **Mirror an existing precedent.** When extending a seam, match the store-and-forward pattern, JSDoc tone, and field placement of a sibling option (e.g. `namespace` was the template for `defaultConvention`) so a reader pattern-matches one to the other.
- **Update the file-level doc.** Seam files carry prose at the top describing the customization story; a new knob means a new sentence there, not just a JSDoc on the field.
- **A "how would someone use this?" question is a real gap, not a documentation request.** If you can't answer it by pointing at the seam file alone, add the missing entry point — don't paper over with an external doc.

## App tool naming

Naming rules for new MCP tools and apps (the `<ui-verb>_model_app` / action-verb dichotomy) live in the local `tool-naming` skill at `.claude/skills/tool-naming/SKILL.md`. Invoke it explicitly with `/tool-naming` when you're about to name a NEW tool or app. It is opt-in — it does not auto-fire on every tool-touching edit, only when you ask for naming guidance.

Data tools take the action-verb shape (`create_model`, `update_model`, `delete_model`, `find_records`, `list_models`); app tools take the UI-intent shape (`new_model_app`, `edit_model_app`, `show_model_app`, `list_model_app`). See the skill for the full ruleset, worked examples, and rationale.

## Never name downstream implementors

mcp-rune is the open-source framework; the projects that consume it are deployers/implementors and stay anonymous in this repo. **Do not mention any specific downstream consumer (private or public) by name in source, comments, docs, plans, commit messages, or PR descriptions.** When you need to illustrate a usage pattern, describe the _shape_ of the consumer ("a deployer that exports `MODEL_CLASSES`", "a prompt whose parent is fixed at construction") — never the identity. This applies even when you learned the pattern by reading a specific consumer's code.

## Examples in comments use the examples-repo domain

When a docstring, JSDoc, or inline comment needs an illustrative `Prompt` / `Model` / `App` example, draw it from the domains in `@mcp-rune/mcp-rune-examples` (locally `~/Code/mcp-rune-examples`) whenever the API surface permits. Today that means **bookshelf** (`Book`, `Author`, `Genre`) and **tasks** (`Project`, `Task`, `Tag`). Reusing these domains keeps framework docs anchored to runnable code a reader can open, and avoids inventing one-off names that don't exist anywhere else in the ecosystem.

Pick the smallest example domain that exercises the feature being documented — e.g. a single-field `TagPrompt` for trivial cases, `BookPrompt` when you need a natural enum-gated conditional (`status: 'completed'` → rating/notes). Only invent a fictional model when no examples-repo domain can express the feature without distortion, and note why in the comment.

The mcp-rune source API is the source of truth for the example's _syntax_ (e.g. `static formStrategy`, `static fieldDefinitions`); the examples repo is the source of truth only for the _domain vocabulary_. If the two diverge, the framework wins — don't propagate stale examples-repo syntax into framework comments.

## Tutorial docs are verified from a clean scaffold

Any guide under `docs/guides/` with commands a reader runs is a **tutorial**: it is not "done" until its executable test in `__tests__/docs/` is green (`npm run docs:verify`), and its `> Verified against …` stamp is **generated** by `npm run docs:stamp` — never hand-edited. One manifest (`docs/verified-with.json`) pins the toolchain for every page, so no two tutorials drift to different versions; `npm run docs:stamp:check` gates it in CI.

The full workflow — the harness, the manifest fields, changing a step, bumping the toolchain, and extending coverage to a new chapter — lives in **docs/README.md → "Verifying tutorials"**. Read it before you add or edit a tutorial.

## Before releasing

Run the full gate locally before you tag or `/ship`. Master merges through PRs and direct pushes are blocked, so every problem CI catches after a tag costs a whole follow-up PR — the cheapest place to find them is your own machine, in one command. Two steps catch what has bitten releases before:

- **`git status` must be clean.** Every reformat or fix has to be committed; an uncommitted file silently misses the release and lands master red. Stage with `git add -A`, not a narrow pathspec (a quoted `**/*.md` once skipped three root files and merged them unformatted).
- **`npm run verify:release` must pass.** It chains every CI gate in one shot — `audit` (`npm audit --audit-level=high`), `format:check`, `lint`, `build:check`, `docs:stamp:check`, `build:full`, `test`, and the executable-docs suite (`docs:verify`) — so failures surface before tagging, not after. It is heavy (the docs suite scaffolds projects and installs over the network); budget a few minutes. When the `audit` step fails on a high/critical advisory, run `npm audit fix`, re-run `verify:release`, and commit the updated `package-lock.json` _before_ tagging — never fold `npm audit fix` into the tag step itself, or you ship a lockfile change that was never part of the verified build.

Only when both are green do you tag and push. The one thing `verify:release` cannot check is the npm `publish` step: it needs an npm **automation** token (granular, 2FA-bypassing) in the `NPM_TOKEN` secret — a normal token fails publish with `EOTP` (one-time-password required). That is an account/secret setting, not a code fix.

## Epic workflow for complex changes

For very complex changes, open a single GitHub **epic issue** before any code lands. The epic body enumerates every concrete sub-change in detail — file paths, axes, ordering, BREAKING flags, downstream-fork checks — and stays open as the source of truth for the whole effort.

Then ship the sub-changes one at a time: open a focused sub-issue per axis (or per natural bundle of axes that touches the same files), open a PR that closes that sub-issue, `/ship` to merge + tag, repeat until every axis on the epic is covered. Close the epic with a summary table (axis → issue → PR → tag) when the last sub-PR lands.

Each sub-PR stays small enough to review and version-bumpable on its own; the epic carries the connecting tissue without bloating individual PR descriptions, and is where scope shifts get recorded mid-flight rather than buried in commit messages.

## Roadmap

Workflow for the public Roadmap (milestones, `area:*` / `status:*` / `shipped-in:*` labels, theme convergence) lives in the local `roadmap` skill at `.claude/skills/roadmap/SKILL.md`. Invoke it explicitly with `/roadmap` when you're about to open, label, close, or milestone-manage a Roadmap-relevant issue. It is intentionally opt-in (not auto-loaded) while the project is in heavy BREAKING-changes phase, since almost any issue could plausibly be Roadmap-relevant and auto-firing would defeat the extraction.
