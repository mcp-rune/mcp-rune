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

### Folder layout that supports the rule

The three layers sit at the same depth under `src/mcp/`, separated from the **declarative** side of model definitions:

- `src/mcp/data-layer/` — backend I/O seam
- `src/mcp/model-layer/` — generic, per-model-bound model-config consumers
- `src/mcp/analysis-layer/` — analysis-domain consumers
- `src/mcp/models/` — **what a model IS**: `base-model.ts` and the `kinds/` registry. _Never_ dump helpers that consume a model into this folder; they belong in `model-layer/` or `analysis-layer/`.

When introducing a new domain seam later (e.g. an auth-layer, a workflow-layer), the same dichotomy applies: a sibling top-level folder for the layer; the declarative side stays in its own folder.

## App tool naming

Naming rules for new MCP tools and apps (the `<ui-verb>_model_app` / action-verb dichotomy) live in the local `tool-naming` skill at `.claude/skills/tool-naming/SKILL.md`. Invoke it explicitly with `/tool-naming` when you're about to name a NEW tool or app. It is opt-in — it does not auto-fire on every tool-touching edit, only when you ask for naming guidance.

Data tools take the action-verb shape (`create_model`, `update_model`, `delete_model`, `find_records`, `list_models`); app tools take the UI-intent shape (`new_model_app`, `edit_model_app`, `show_model_app`, `list_model_app`). See the skill for the full ruleset, worked examples, and rationale.

## Roadmap

Workflow for the public Roadmap (milestones, `area:*` / `status:*` / `shipped-in:*` labels, theme convergence) lives in the local `roadmap` skill at `.claude/skills/roadmap/SKILL.md`. Invoke it explicitly with `/roadmap` when you're about to open, label, close, or milestone-manage a Roadmap-relevant issue. It is intentionally opt-in (not auto-loaded) while the project is in heavy BREAKING-changes phase, since almost any issue could plausibly be Roadmap-relevant and auto-firing would defeat the extraction.
