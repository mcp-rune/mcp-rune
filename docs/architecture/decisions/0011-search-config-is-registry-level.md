# 0011. Search configuration is registry-level; projection code searches only through the DataLayer seam

- Status: Accepted
- Date: 2026-07-03
- Related: #348, #359, [ADR-0009](0009-kinds-are-shared-vocabulary.md)

## Context

The search knobs lived in two irreconcilable states. On the apps side, `searchGroups` and `defaultShaper` were typed `AppRegistry` options, and every app handler received a `DataLayer` pre-wrapped in `SearchEnabledDataLayer`. On the tools side there was no typed home at all: the knobs were smuggled through the untyped `serverContext` bag and recovered by casts inside `createSearchService`, `ToolRegistry` handed tools a bare adapter, and the framework's own `search_records` and `analysis_ingest` constructed `SearchService` directly — routing around the seam that exists so projection code never composes a search adapter. The seam file's own prose pointed at a third state that never existed ("declare `searchGroups` on the search ApiExtension" — `searchExtension()` takes no config). Two more asymmetries rode along: `namespace` applied to CRUD but nothing defined its relationship to search endpoints, and the same conceptual search group had to be declared twice in two shapes (`SearchGroup` for routing, the picker's private `SearchGroupConfig` for presentation).

## Decision

**Search configuration is declared once, typed, at the registry — and every projection consumer reaches search exclusively through the `*Normalized` methods on the `DataLayer` seam.**

- `searchGroups` / `defaultShaper` are typed options on both `ToolRegistryConfig` and `AppRegistry` options, with identical semantics; a deployment declares the group objects once and passes the same value to both.
- Both registries wrap every per-request `DataLayer` in `SearchEnabledDataLayer` — always, not conditionally: the wrapper also serves per-model `extensions.search` config and nested-only models, so it earns its place even with zero groups configured.
- `search_records` and `analysis_ingest` call `dataLayer.searchNormalized`; the tools-side `createSearchService` path and the `serverContext` bag-cast are deleted. `createSearchService` remains as the one construction point the two registries share.
- **One `SearchGroup` shape carries both halves**: routing (`endpoint`, `modelsParam`, `shaper`, `queryParam`, `expand`) consumed by `SearchService`, and presentation (`label`, `description`, `typeField`, `models`) consumed by pickers. `createDefaultAppRegistry` forwards the same objects to the registry and the picker.
- **Search endpoints are namespace-exempt, by contract.** `namespace`/`apiNamespace` applies to model CRUD endpoints; per-model search endpoints and group endpoints are declared fully qualified. `AppRegistry` gains `apiNamespace` so app CRUD and tool CRUD hit the same URLs.

## Options considered

**Config on `searchExtension()` instead of the registries — rejected.** The extension contributes tools; the knobs configure the data layer that even non-extension consumers (apps, `analysis_ingest`) need. Registry-level config also already had a working, typed precedent on the apps side — the decision mirrors it rather than inventing a second pattern.

**Typing the `serverContext` bag — rejected.** It would legitimize a side-channel whose only merit was that it existed. `ServerContext` is for disambiguation metadata, not dependency wiring; the registry config is where every sibling knob (`namespace`, `defaultConvention`, `dataLayer`) already lives.

**Wrapping only when `searchGroups` is configured — rejected.** Conditional wrapping makes `searchNormalized`'s behavior depend on unrelated config, and per-model `extensions.search` routing needs the wrapper with zero groups declared. Always-wrap gives one behavior to reason about, matching what apps already did.

**Auto-applying `namespace` to search endpoints — rejected.** Every known deployment declares search endpoints fully qualified (often pointing at a dedicated search service outside the model namespace), so auto-prefixing would silently break them all; and a group endpoint has no model from which to resolve a per-model namespace override. The exemption is now stated at the seam instead of left ambiguous.

## Consequences

- BREAKING for deployments that passed `searchGroups`/`defaultShaper` through `serverContext`: move them to the registry config (a one-line change; both known downstream forks use exactly this pattern).
- The picker's private `SearchGroupConfig` is gone; its `name`/`typeField` fields map to `SearchGroup.label`/`typeField` (pickers default `typeField` to `type`).
- `SearchService` becomes an implementation detail of `SearchEnabledDataLayer` from the projection layer's point of view — a future lint gate on data-layer internals (epic task 3) can restrict it without carve-outs for tools.
- The `search_records` tool now takes the same code path as apps for identical inputs, removing the class of divergence behind the filter-drop bug (fixed independently as epic task 7).
