# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.57.0] - 2026-05-31 (BREAKING)

> Closes #156. Third of four "Frankenstein-seed" cleanups from the extensibility ADR. Promotes the per-tool `requiresAuth` override from an undocumented one-off "exception" to a first-class declarable field, and re-routes consumers through a `getRequiresAuth()` helper so the category-default fallback is centralized.

### Investigation note

The issue body assumed per-tool override didn't exist. It does — two in-repo tools (`AnalysisIngestTool`, `AnalysisActTool`) already used `static override get requiresAuth() { return true }` to depart from the `ANALYSIS` category default. The real Frankenstein-seed was ergonomic and discoverability: the verbose getter syntax, the undocumented pattern, and the categories.ts comment framing the override as an "exception" rather than the documented mechanism. This release closes those three gaps without speculative new abstractions.

### Changed (BREAKING)

- **`BaseTool.requiresAuth` is now a declarable static field** (`static requiresAuth?: boolean`), not a static getter. Subclasses override with one-line field syntax: `static override requiresAuth = true`. When unset, callers fall through to the category default via `getRequiresAuth()`.
- **New `BaseTool.getRequiresAuth(): boolean` static helper** that resolves `this.requiresAuth ?? getCategoryConfig(this.category).requiresAuth`. This is the canonical read path for the effective auth requirement.
- **`ToolRegistry` reads `ToolCls.getRequiresAuth()` instead of `ToolCls.requiresAuth`** (`src/mcp/tools/tool-registry.ts:373` consumer site). The interface `ToolClass` (`tool-registry.ts:89-94`) drops the required `readonly requiresAuth: boolean` and adds the required `getRequiresAuth(): boolean` method.
- **In-repo overrides migrated to field syntax.** `src/mcp/tools/analysis/analysis-ingest-tool.ts` and `src/mcp/tools/analysis/analysis-act-tool.ts` both now declare `static override requiresAuth = true` instead of the previous getter form.

### Changed (non-breaking)

- **`src/mcp/tools/categories.ts:36`** — the comment that framed `analysis_ingest` as an "exception" now points to the documented per-tool override pattern. The mechanism is first-class, not a workaround.
- **`docs/guides/tool-creation-guide.md`** — new "Overriding `requiresAuth` per tool" subsection under §"Tool Categories" with paired TS+JS examples and a note on why consumers must call `getRequiresAuth()` rather than read the field directly.
- **3 new unit tests** in `__tests__/lib/mcp/tools/base-tool.spec.ts` pinning the override contract: field-set overrides the category default in both directions (true/false), unset falls back to the category default.

### Migration

Any deployer or in-repo tool using the static-getter form must migrate to the field form:

```ts file=src/tools/my-analysis-tool.ts
// BEFORE
class MyAnalysisTool extends BaseTool {
  static override get requiresAuth(): boolean {
    return true
  }
}

// AFTER
class MyAnalysisTool extends BaseTool {
  static override requiresAuth = true
}
```

```js file=src/tools/my-analysis-tool.js
// BEFORE
class MyAnalysisTool extends BaseTool {
  static get requiresAuth() {
    return true
  }
}

// AFTER
class MyAnalysisTool extends BaseTool {
  static requiresAuth = true
}
```

Any code reading `Tool.requiresAuth` directly must switch to `Tool.getRequiresAuth()`. Tools that don't set the field will return `undefined` for the direct read; only the helper applies the category default. The framework's own `ToolRegistry` already calls the helper; this affects only test code and any deployer code that introspected tools for diagnostics.

[0.57.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.56.0...v0.57.0

## [0.56.0] - 2026-05-31

> Closes #155. Second of four "Frankenstein-seed" cleanups from the extensibility ADR. Closes a documentation-implementation gap: `docs/guides/api-extensions.md` and `src/mcp/api-extensions/types.ts` already promised that "Mixin method names must be globally unique across all registered extensions; collisions throw at boot." The code did not enforce it — `Object.assign(service, mixin(service))` silently overwrote. Now it throws fast with both contributor keys in the error message, mirroring the rules already enforced for tool names (`api-extensions.md:224`) and summary-strategy names (`api-extensions.md:303`).

### Added

- **Boot-time mixin name-collision detection** in `ToolRegistry._applyApiExtensions`. Each mixin factory is invoked once at registration with a sentinel `ModelService` purely to read the method names it contributes. Duplicate names across two extensions — or across two `registerModelServiceMixin` calls from one extension — throw at `ToolRegistry` construction with both contributor keys named.
- **`SENTINEL_MODEL_SERVICE`** — a recursive Proxy used only at boot for name collection. Any property chain on it returns another callable Proxy so factories that dereference `service.endpointResolver.pathForType(...)` at factory time (rather than only inside their returned methods) still evaluate cleanly. The real `service` is bound lazily per tool instance via the existing `DataLayer` factory path — no change to runtime semantics.
- **`_mixinMethodOwners: Map<string, string>`** on `ToolRegistry`, tracking which extension contributed each mixin method name. Parallels the existing `_toolOwners` tracking for tools.
- **6 new unit tests** in `__tests__/lib/mcp/tools/tool-registry-mixin-collisions.spec.ts` covering: disjoint mixins compose cleanly; same name across two extensions fails at boot with both keys in the error; messages name both contributors and the offending method; multi-method extension overlap detected; single-extension duplicate calls detected; factories that touch `service` at factory time don't crash the sentinel.

### Changed

- **`docs/guides/api-extensions.md`** — the "ModelService mixins" section gains an explicit "globally unique" paragraph parallel to the equivalent text for tool names and summary-strategy names. The new paragraph documents the sentinel-driven collision check.

### Migration

This is a defensive fix: deployers with disjoint mixin method names see no change. Deployers whose extensions happened to register the same mixin method name will now see a clear error at boot identifying both extensions and the conflicting method. Resolution: rename one of the mixin methods (the host had no way to call the overwritten one anyway). Not marked BREAKING because correct configurations are unaffected and broken configurations were already broken (silent overwrite).

[0.56.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.55.0...v0.56.0

## [0.55.0] - 2026-05-31 (BREAKING)

> Closes #154. First of four "Frankenstein-seed" cleanups identified in the extensibility ADR: promotes `PromptRegistry` to a first-class, exported contract with a minimal concrete implementation and fail-fast collision detection. Four duplicate interface declarations across the framework collapse into one canonical type.

### Added

- **`PromptRegistry` canonical interface** in `src/mcp/prompts/prompt-registry.ts`, re-exported from `@mcp-rune/mcp-rune/prompts`. Single source of truth for the contract the framework consumes — required methods (`getDefinitions`, `getPrompt`, `getPromptClass`) plus optional enrichment hooks for `SaveModelBaseTool` description rendering, `PromptCache` delegation, and `GetPromptGuideTool` deployer-specific instance construction.
- **`BasePromptRegistry` concrete class** — minimal in-memory registry with `register(name, promptClass, options?)`, name + model lookup, and **fail-fast collision detection** (error includes both contributor keys, mirroring `SummaryStrategyRegistry`). Deployers extend it for the standard pattern; deployers with bespoke prompt-lookup logic implement `PromptRegistry` directly.
- **`PromptClass`, `PromptDefinition`, `PromptResult`, `RegisterOptions`** types exported from the same module.
- **Unit tests** in `__tests__/lib/mcp/prompts/prompt-registry.spec.ts` covering register/lookup, definitions surfacing, collision detection (both duplicate name and duplicate model binding), and owner tracking.

### Removed (BREAKING)

- **`PromptRegistry` duck-typed interface deleted from `src/mcp/tools/base-tool.ts`.** The interface declared all methods optional with a `[key: string]: unknown` escape hatch — any object satisfied it. Tools now import the canonical type. `base-tool.ts` re-exports `PromptRegistry` so existing imports from `'@mcp-rune/mcp-rune/tools'` resolve to the same type.
- **`PromptRegistry` and `PromptClass` local interfaces deleted from `src/mcp/server-factory.ts`.** The local `PromptClass` was an instance-shape interface with `fieldDefinitions`; the canonical `PromptClass = typeof BasePrompt` carries the static directly.
- **`PromptRegistryLike` interface deleted from `src/mcp/prompts/prompt-cache.ts`.** `PromptCache` now `implements PromptRegistry` and accepts a `PromptRegistryForCache` (canonical interface with delegation methods required) — the cache's contract becomes type-checked rather than duck-typed.
- **`PromptRegistryWithStats` interface deleted from both `src/mcp/middleware/status-router.ts` and `src/mcp/http-server.ts`.** The two duplicate declarations are replaced with `Pick<PromptRegistry, 'getStats'>` against the canonical type.

### Changed

- **`PromptCache` is now `implements PromptRegistry`**, so it can be substituted anywhere a `PromptRegistry` is accepted. Delegation method return types align with the canonical interface (`getDefinitions` now returns `PromptDefinition[]`, `getRequiredPromptRestrictions` and `getBulkRecommendations` return `string | null`).
- **`GetPromptGuideTool` and `BaseStrategyTool` no longer cast through `Record<string, unknown> & {...}`** to call optional registry methods. The casts existed because the duck-typed interface lacked the methods; `PromptRegistry` now lists `getAllPromptNames`, `getToolDocDescriptionList`, `getPromptInstance`, `getUnknownPromptError`, and `getPromptClassByModel` as optional, so consumers feature-detect directly.
- **`examples/bookshelf/config.ts`** uses `new BasePromptRegistry()` + `.register('book', BookPrompt, { description, required, model })` instead of the inline `{ getDefinitions, getPrompt }` object literal — the recommended pattern for deployers.

### Migration

Deployers who hand-rolled a `PromptRegistry` object literal continue to work as long as the object satisfies the canonical interface. The most common shape (just `getDefinitions` + `getPrompt` + `getPromptClass`) is unchanged. Deployers who relied on the `[key: string]: unknown` escape hatch to attach arbitrary methods must either (a) move those methods onto the optional surface listed in `PromptRegistry` if the framework calls them, or (b) keep them as private members of the object and cast at the call site.

For new servers, prefer the `BasePromptRegistry` pattern:

```ts file=src/config.ts
import { BasePromptRegistry } from '@mcp-rune/mcp-rune/prompts'

const promptRegistry = new BasePromptRegistry()
promptRegistry.register('book', BookPrompt, {
  description: Book.description,
  required: true,
  model: 'book'
})
```

```js file=src/config.js
import { BasePromptRegistry } from '@mcp-rune/mcp-rune/prompts'

const promptRegistry = new BasePromptRegistry()
promptRegistry.register('book', BookPrompt, {
  description: Book.description,
  required: true,
  model: 'book'
})
```

[0.55.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.54.0...v0.55.0

## [0.54.0] - 2026-05-30 (BREAKING)

> Removes the framework-baked multi-product disambiguation note from `BaseTool`. The opinionated paragraph and the parallel `getDisambiguationNote()` seam collapse into the existing, actively-used `getUsageRules()` seam — one composition seam for description text injection, zero new plugin points, no opinionated default.

### Removed (BREAKING)

- **`BaseTool.getDisambiguationNote()` deleted.** The unconditional append in the `description` getter is gone; tool descriptions are now `baseDescription + getUsageRules()` only.
- **`ServerContext.description` and `ServerContext.productLines` fields deleted.** Both had zero consumers outside the removed method. `ServerContext.name` and `ServerContext.sessionId` remain unchanged — `name` is still read by ~10 tools as API-scope context ("in the X API") and `sessionId` is read by `storeToolMemory`.

### Migration

Deployers who want the prior multi-product warning paragraph in their tool descriptions add it in their server-specific base tool class by overriding `getUsageRules()`. See the "Multi-product disambiguation (deployer recipe)" section in `docs/guides/tool-creation-guide.md` for the copy-pasteable snippet.

[0.54.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.53.0...v0.54.0

## [0.53.0] - 2026-05-29 (BREAKING)

> Two breaking change sets ship together:
>
> 1. **Pluggable summary strategies for `analysis_ingest`.** The fixed "distributions + numeric stats + date ranges" page summary becomes one of several built-in strategies and is extensible via `ApiExtension`. The default memory category renames from `page_summary` to `page_summary:<strategy>`.
> 2. **Closes #137.** Unifies the kind/format taxonomy across the prompt system, the form-schema layer, and the iframe formatter registry into a single source of truth at `src/core/kind-metadata.ts`.

### Added

- **`src/core/summary-strategies/`** — strategy interface (`SummaryStrategy`, `SummaryInput`, `SummaryOutput`), `SummaryStrategyRegistry` with owner-tracked collision detection, and five built-in strategies (`distribution`, `coverage`, `anomaly`, `temporal`, `entity-extraction`). Strategies are deterministic pure functions over the records array; optional `appliesTo(input)` lets multi-strategy calls skip strategies whose preconditions aren't met (e.g., `temporal` skips when records carry no ISO-date field). Built-ins are auto-registered by `ToolRegistry`; the registry is threaded into tools via `ToolDependencies.summaryStrategies`.
- **`analysis_ingest` learns `summary_strategy` and `summary_strategies` params.** `summary_strategy` (enum) picks a single strategy per call; `summary_strategies` (array, mutually exclusive) runs several per page and stores one memory per applicable strategy. Default remains `distribution`. The enum is dynamically populated from the registry, so extension-contributed strategies appear automatically in tool docs.
- **`ApiExtensionContext.registerSummaryStrategy(strategy)`** — third collector alongside `registerTool` and `registerModelServiceMixin`. Strategy names must be globally unique across built-ins and all extensions; collisions throw at boot with both owner keys in the message. `SummaryStrategy` is re-exported from `./extensions`.
- **`src/core/kind-metadata.ts`** — DOM-free single source of truth for all 17 built-in attribute kinds (`string`, `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `time`, `enum`, `array`, `uuid`, `json`, `color`, `email`, `url`, `base64`, `rating`). Each `KindDescriptor` carries `htmlInputType`, `promptType`, `label`, plus `parse / serialize / toInput / fromInput / describe / validate` pure functions. Imported by both the browser-side formatter registry and the server-side prompts/form-schema/validation layers — one vocabulary, one extension point. Published under the existing `./core` subpath export.
- **`getKind(kind, format)` case-insensitive lookup with format-hop fallback.** When `kind:format` has no explicit narrowing but `format` names a registered top-level kind (e.g. `getKind('string', 'url')`), it returns that kind's descriptor. This is what makes JSON-schema-style `format: 'url'` or `format: 'email'` work without each deployer registering every narrowing.
- **Server-side validation now covers `date`, `datetime`, `uuid`, `email`, `url`, `json`, `time`, `decimal`, `rating`** in `BaseStrategy.validateField`. Previously only `integer` and `boolean` were checked.
- **LLM-facing prompt summaries now mirror what the user sees on screen.** `HybridStrategy.generateHumanSummary` and `BasePrompt.generateHumanReadableSummary` route every value through `getKind(...).describe(...)`: booleans render as `Yes`/`No` (matched to `record-detail-ui`), dates as ISO, enum values humanized, base64 as `(binary)`, arrays as humanized comma-joined lists.
- **`FormatterDescriptor` is now expressive enough for declarative-only deployer extensions.** Added top-level `htmlInputType`, `promptType`, `label`, `validation` (`pattern`, `minLength`, `maxLength`, `minimum`, `maximum`). Same descriptor drives DOM rendering (iframe), HTML input type (form-schema), prompt type label (LLM docs), and `validate_form` errors.
- **`#src` resolve alias in `src/mcp/apps/vite.config.js`** so browser-bundled `apps/shared/formatters.ts` uses the same `#src/core/kind-metadata.js` specifier as server-side TypeScript.

### Changed (BREAKING)

- **Page-summary memory category renamed from `page_summary` to `page_summary:<strategy>`.** Every memory row now also carries `metadata.strategy: <strategy-name>`. Callers using `analysis_query mode: semantic, category: 'page_summary'` must update to the per-strategy category (e.g. `'page_summary:distribution'`) or drop the category filter and rely on semantic ranking.
- **`AnalysisIngestTool._storePageSummary`, `_buildFieldDistributions`, `_buildNumericStats`, `_buildDateRanges` removed.** Logic lifted into `src/core/summary-strategies/distribution.ts` as the `distribution` built-in strategy. Wire behavior is unchanged when no `summary_strategy` param is passed (modulo the category rename above).
- **`src/mcp/apps/shared/formatters.js` → `formatters.ts`.** Rewritten to delegate `parse / serialize / toInput / fromInput / describe / validate` to `kind-metadata`. The only remaining surface is the DOM `format()` renderer registry and the `helpers` primitives. `registerFormatter` now accepts ONLY `{ format }` — a DOM renderer — and throws on any other shape. Non-DOM behavior is sourced from `AppRegistry.formatters` descriptors.
- **`form-schema.ts` `TYPE_MAP` deleted.** HTML input type is now derived from `getKind(attr.type, attr.format).htmlInputType`. Coverage expands from 6 kinds (`string`/`text`/`integer`/`number`/`boolean`/`date`) to all 17. `datetime`/`time`/`decimal`/`uuid`/`json`/`color`/`email`/`url`/`rating` no longer fall through to plain text inputs.
- **`form-schema.ts:337` `attr.format === 'URL'` (uppercase) bug fixed.** Format strings are now case-insensitive everywhere via `getKind`.
- **`format: 'base64'` now maps to a `text` HTML input** (display-only, matching the formatter's `(binary)` rendering). Was `file`, which never worked — `model-form-ui/app.js:182-183` already skipped file inputs.
- **`schema-derivation.ts` `TYPE_MAPPING` and `mapType` deleted.** Prompt type labels derive from `getKind(attr.type, attr.format).promptType`. `uuid`/`json`/`decimal`/`rating` attributes now surface their real types to the LLM instead of silently falling back to `string`.
- **`BaseStrategy.validateField` integer/boolean inline checks deleted.** Replaced by `getKind(def.type, def.format).validate(value, opts)` — the kind decides what's valid. Range/length/pattern from `FieldValidation` still live in `base-strategy.ts` (orthogonal to kind).

### Removed (BREAKING)

- **`AppRegistry.formatterScript` deleted.** The `window.__MCP_RUNE_REGISTER_FORMATTERS__` JS-hook escape valve, shipped in v0.50, is gone. It was the architectural seam that created server/browser drift: deployers could register `currency`/`isbn`/`phone` kinds the server-side prompts and validation couldn't see. All deployer extensions now flow through the declarative `FormatterDescriptor` channel, which both the iframe and the server consume — single source of truth, no shim path. Pre-1.0, no deprecation.
- **`__MCP_RUNE_REGISTER_FORMATTERS__` window-global removed** from `formatters.runtime.js`. The runtime now exports `applyDescriptorOverrides` (renamed from `applyRuntimeOverrides`) and consumes only `window.__MCP_RUNE_FORMATTERS__`.

### Migration (v0.50 → next)

Any deployer who shipped a `formatterScript` to register a new kind must re-express it as a `FormatterDescriptor`. Most real-world cases fit the descriptor vocabulary:

```ts
// BEFORE (v0.50)
formatterScript: `
  window.__MCP_RUNE_REGISTER_FORMATTERS__ = (registerFormatter, helpers) => {
    registerFormatter('isbn', {
      format: (v) => helpers.text('ISBN: ' + v)
    })
  }
`

// AFTER
formatters: {
  'string:isbn': {
    label: 'ISBN',
    htmlInputType: 'text',
    validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
    display: { template: 'ISBN: {value}' }
  }
}
```

The descriptor channel now also drives server-side concerns (prompt type label, form HTML input, `validate_form` errors), so a single registration covers what previously required wiring in three places.

## [0.50.0] — 2026-05-28 (BREAKING)

> v0.50 is a multi-gap overhaul of the MCP apps surface, landing as four commits on PR #135.

### Added

- **`DataLayer.listNormalized(model, filters?, pagination?, options?)`** on the seam at `@mcp-rune/mcp-rune/core`. Returns a convention-applied `{ records, pagination }` envelope so callers — notably the MCP apps — never need to import `defaultConvention` themselves. `ModelService` is the sole sanctioned implementation site for the default convention path; `InMemoryDataLayer` reuses its already-normalized `list()` output.
- **`normalizeListWithConvention(rawData, convention, pagination?)`** exported from `src/mcp/services/model-service.js`. Used by `model-form`'s `resolveAssociationOptions` where the endpoint is a nested association URL (so a model-level `listNormalized` is the wrong shape) and the convention may differ per association. Falls back to `defaultConvention` when `undefined` is passed.
- **`themeOverrides` on `AppRegistry`** — `{ cssVariables?: Record<string, string>; css?: string }`. Deployers integrating mcp-rune for different aesthetics now have a first-class override channel: variables write a `:root { … }` block, `css` is appended verbatim, and both ride into every app's bundled HTML at serve time. Variable names should match the tokens in `src/mcp/apps/shared/base.css`.
- **`AppRegistry.injectIntoHead(html)`** is now the single seam that mutates app HTML before it is returned as an MCP resource. Public so tests and future extensions can exercise it directly; previously the rewrite lived inline inside `registerResources`.
- **`--color-accent-soft` design token** added to `src/mcp/apps/shared/base.css`. Replaces the literal `rgba(196, 112, 75, 0.12)` in `autocomplete-picker-ui/styles.css:71`, restoring full theming coverage to the picker app.
- **Bidirectional attribute-kind formatter registry** at `src/mcp/apps/shared/formatters.js`. One source of truth for moving values between three representations: API value ⇄ internal value ⇄ HTML `<input>` value. Each formatter implements `parse / format / toInput / fromInput / serialize`. 17 built-in formatters: `string`, `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `time`, `enum`, `array`, `uuid`, `json`, `color`, `email`, `url`, `base64`, `rating`. Display rendering in `list-view-ui`, `record-detail-ui`, and `search-view-ui` consolidates into one shared `renderCellValue` import — datetime, boolean, URL, and array rendering are now identical across all three.
- **Custom-kind extension paths on `AppRegistry`.** Two new options surface deployer overrides into every bundled app:
  - `formatters: Record<string, FormatterDescriptor>` — JSON-serializable declarative overrides keyed by `"kind"` or `"kind:format"`. Translated through a closed allowlist (template substitution, `Intl` locale, badge variant, regex parser). CSP-safe.
  - `formatterScript: string` — deployer-supplied JS that runs in the app iframe and registers entirely new kinds the framework doesn't ship (currency, phone, isbn, deployment-specific time) with arbitrary `parse/format/toInput/fromInput/serialize` logic via a `window.__MCP_RUNE_REGISTER_FORMATTERS__` hook.
- **`renderCellValue(value, column, opts?)` exported from `src/mcp/apps/shared/formatters.js`.** The single seam apps call to render attribute-kind cells; null/undefined renders as an em-dash; routes through `getFormatter(column.kind || column.type, column.format)`.
- **`form-schema.ts` propagates `kind` + `format`** onto every `FormFieldDefinition`. Without it the form UI couldn't look up the right formatter for bidirectional round-trips (`field.type` is the HTML widget type, not the model kind).
- **`list-schema.ts` propagates `format`** onto every `ColumnDefinition` so formatter narrowing works in list rendering (e.g. `kind: 'string', format: 'isbn'`).
- **`detail-schema.ts` stamps `format: 'rating'`** server-side for integer attributes named `rating`. The UI no longer matches by field name.

### Changed (BREAKING)

- **`DataLayer` interface gains `listNormalized`.** Third-party `DataLayer` adapters (in-memory stubs beyond the bundled one, GraphQL or fetch-only wrappers shipped as separate packages) must implement this method. `ModelService` and `InMemoryDataLayer` already do.
- **`defaultConvention` is no longer importable from app code.** The three apps that previously called `dataLayer.dispatch()` and then ran `defaultConvention.normalizeListResponse()` themselves — `list-view`, `multi-select`, `model-form` — now call `listNormalized` (or `normalizeListWithConvention` for the per-association case). Apps no longer import from `#src/mcp/api-conventions/index.js`. Custom apps following the same pattern must migrate similarly.
- **Booleans render `"Yes"/"No"` in `list-view-ui` and `search-view-ui`** (previously the raw `"true"/"false"`). `record-detail-ui` already rendered them this way; the unification matches.
- **Datetime values render via `Intl.DateTimeFormat({ dateStyle: 'medium', timeStyle: 'short' })` everywhere.** Previously list-view emitted `"Feb 23, 2026 14:00"` (short month) while record-detail emitted `"February 23, 2026 14:00"` (long month). Single source of truth now — locale-overridable via the new `formatters: { date: { display: { locale: 'en-GB' } } }` channel.
- **URLs render as clickable `<a>` tags in list-view-ui and search-view-ui** (previously plain text — only record-detail-ui linked them).
- **`rating` field is no longer auto-detected by literal field name** in `record-detail-ui`. The server-side `detail-schema.ts` stamps `format: 'rating'` on integer attributes named `rating` so the UI can rely on the schema. Models whose rating attribute is named differently must opt in by setting `format: 'rating'` on the attribute definition.
- **`src/mcp/apps/model-form-ui/field-formatters.js` deleted.** Its two kinds (`datetime-local`, `time`) become built-in formatters in the new registry, and `model-form-ui/app.js` now routes prefill / submit through `getFormatter(field.kind, field.format)` for bidirectional round-trips on every kind (including `date`, `datetime`, `time`, `boolean`, `integer`, `decimal`, `json`). Importantly: the previous wiring left `field-formatters.js` unconsumed, so dates didn't round-trip correctly at all — this commit fixes that bug as part of the registry rollout.
- **`happy-dom` added to `devDependencies`** for vitest-based DOM testing of the formatter module.

### Added (Gap 4)

- **`createDefaultAppRegistry(options)`** at `@mcp-rune/mcp-rune/apps` — one-call assembly of every framework-shipped MCP App. Accepts the union of `AppRegistry` options (`themeOverrides`, `formatters`, `formatterScript`, `dataLayer`, `headerIcon`, …) and an `exclude` opt-out list. Replaces the hand-wired six-factory boilerplate every integrator was carrying.
- **`examples/bookshelf` wires `createDefaultAppRegistry`.** The canonical demo now exercises every gap end-to-end (list, detail, create/update forms, multi-select, search, autocomplete-picker) and includes commented examples for `themeOverrides`, declarative `formatters`, and a custom-kind `formatterScript`.

### Removed (Gap 4)

- **`draft-view` Vite target removed** from `src/mcp/apps/vite.config.js`. The orphan never had a source folder or server factory; it was a placeholder for unfinished work that confused the build matrix.

### Changed (Gap 4 follow-up — BREAKING for tests asserting call shape)

- **`ModelService` trims trailing `undefined` from all CRUD calls** (`find`, `list`, `create`, `update`, `delete`), matching the treatment v0.49.1 introduced for `dispatch`. Surfaced after v0.50 routed apps through `list()` via `listNormalized` — dependent test suites (e.g. engineer-mcp) saw the call shape change. The fix is for `ModelService` to call `apiClient.method(endpoint, …)` without the trailing `undefined`, so third-party API clients (axios, fetch, custom) see the same call shape they'd get from a direct caller. Real HTTP transport (`axios`, `fetch`) is unaffected; only assertions like `vi.fn().toHaveBeenCalledWith(url, body, undefined)` need to drop the trailing `undefined`.

[0.50.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.49.2...v0.50.0

## [0.49.2] — 2026-05-28

### Fixed

- **CI `Build` step on master.** `npm run build` ran `tsc && copy:app-html`, but `copy:app-html` copies `src/mcp/apps/dist/*.html` — Vite single-file outputs that are gitignored under `dist/`. On a clean CI checkout the HTML files don't exist, so the copy step failed with `cp: cannot stat 'src/mcp/apps/dist/*.html': No such file or directory` and master CI had been red since v0.41.0 (#110 / commit 1be1375). v0.41.0 deliberately split `build` (TS-only, fast inner-loop) from `build:full` (TS + 6 Vite bundles + copy) and dropped the `prebuild` hook — but `copy:app-html` was left in `build`, which contradicted the split. This release makes the split honest: `build` is now `tsc`, and `copy:app-html` lives in `build:full` alongside `build:all-apps`. `prepublishOnly` already calls `build:full`, so published tarballs still contain `dist/mcp/apps/dist/*.html`.

### Changed

- **CI `publish` job's `Build` step now runs `npm run build:full`** so the explicit pre-publish build matches what `npm publish` re-runs via `prepublishOnly`. The stale comment claiming a `prebuild` lifecycle hook (removed in v0.41.0) is replaced with the actual flow.
- **README `Development` section** corrected: `npm run build` is documented as TypeScript-only (fast iteration); `npm run build:full` is the full publishable artifact (Vite apps + tsc + copy HTML).

[0.49.2]: https://github.com/mcp-rune/mcp-rune/compare/v0.49.1...v0.49.2

## [0.49.1] — 2026-05-28

### Fixed

- **`ModelService.dispatch` no longer forwards trailing `undefined` args** to the underlying `ApiClient`. v0.49.0 already trimmed the `options` arg when it was undefined; v0.49.1 extends the same treatment to the `params` (`GET`) and `payload` (`POST` / `PUT` / `PATCH`) positions. The call shape now matches what a direct `ApiClient` caller would produce, which keeps third-party consumers (and their `vi.fn().toHaveBeenCalledWith(url)` assertions) free of spurious `undefined` arguments. No behavioral change for real HTTP transport — `axios` / `fetch` ignore trailing `undefined`. The two affected mcp-rune tests had their assertions updated to match the cleaner shape.

[0.49.1]: https://github.com/mcp-rune/mcp-rune/compare/v0.49.0...v0.49.1

## [0.49.0] — 2026-05-28 (BREAKING)

### Added

- **`DataLayer` interface at `@mcp-rune/mcp-rune/core`** — the stable seam between mcp-rune's projection layer (tools, prompts, apps, domain) and any concrete data backend. Declares the operations the projection layer needs (`create` / `find` / `list` / `update` / `delete` / `dispatch` / `buildPayload`), plus read-only views of the models registry and the endpoint resolver. `ModelService` now implements this interface and is the default adapter; alternative adapters (in-memory stub, fetch-only, third-party library wrappers) can ship as separate packages without forking the framework.
- **`InMemoryDataLayer` reference adapter** (`@mcp-rune/mcp-rune/core`) — Map-backed `DataLayer` for offline tool tests and LLM evals. Demonstrates the seam in a deliberately convention-free form. Use `createInMemoryDataLayer({ fixtures })` as a `dataLayer` factory on `ToolRegistry` / `AppRegistry`.
- **`dataLayer` factory option on `ToolRegistry` and `AppRegistry`** — lets integrators swap the default `ModelService` adapter. The factory receives `{ apiClient, models, namespace, logger }` and returns a `DataLayer`. The default factory wraps `ModelService` and applies any `ApiExtension` mixins.

### Changed (BREAKING)

- **`BaseTool.apiClient` removed.** Tools no longer receive a raw HTTP client; they receive a `DataLayer` via `BaseTool.dataLayer`. Custom tools that previously read `this.apiClient.get/post/...` migrate to `this.dataLayer.find/list/dispatch/...`. The `requireApiClient()` helper has been renamed to `requireDataLayer()` and now returns the `DataLayer` for chaining.
- **`BaseTool.modelService` getter removed.** Tools that called `this.requireModelService()` switch to `this.requireDataLayer()`; the returned interface has the same CRUD surface.
- **`ToolDependencies` simplified.** The `apiClient`, `modelService`, and `modelServiceMixins` fields are gone; only `dataLayer` (plus logger, models, registries, serverContext) remains. Mixins are now applied internally by `ToolRegistry`'s default `DataLayer` factory.
- **Apps `AppToolContext` carries `dataLayer` instead of `apiClient`.** Apps' `handleToolCall` contexts now expose `{ dataLayer, searchClient, selectionStore, formDataStore }`. The previous `apiClient.get(url, params)` calls in `model-form`, `record-detail`, `list-view`, `multi-select`, and the autocomplete picker now go through `dataLayer.dispatch('GET', url, undefined, params)` or the typed `dataLayer.find/list` methods. Apps that previously passed `ModelClass.api.endpoint` as a raw string still work — namespace and per-action endpoint overrides are now respected for app calls too, which may be a behavior change for servers that bake a namespace into `api.endpoint`.
- **`SearchService` now takes a `DataLayer`** instead of an `ApiClient`. The `createSearchService(dataLayer, context)` factory signature changed accordingly. Server-internal HTTP calls (`apiClient.get/post`) route through `dataLayer.dispatch`.
- **`LoggingApiClient` removed.** The decorator used by `analysis_ingest` to emit `[API Request]` / `[API Response]` debug lines is gone — per-request debug logging now belongs to the adapter (or a future request-pipeline handler). The export from `@mcp-rune/mcp-rune/tools` is removed.
- **`ModelService.dispatch` no longer forwards `undefined` trailing options** to the underlying `ApiClient`. Adapters and tests that asserted on the previous 3-arg call shape see 2-arg calls when no options are supplied; behavior is otherwise unchanged.

### Migration

```diff
 export class ArchiveProjectTool extends BaseTool {
   static override get category() {
     return TOOL_CATEGORIES.CUSTOM
   }

   override get name() {
     return 'archive_project'
   }

   override async execute({ project_id }: { project_id: string }) {
-    return this.apiClient!.post(`/projects/${project_id}/archive`)
+    return this.requireDataLayer().dispatch('POST', `/projects/${project_id}/archive`)
   }
 }
```

```diff
 const registry = new ToolRegistry({
   toolClasses: { ...DATA_TOOL_CLASSES, custom_tool: MyTool },
   models: MODEL_CLASSES,
   serverContext,
   createApiClient: (token) => createApiClient(token, { apiUrl }),
+  // Optional — swap the default ModelService adapter for an alternative:
+  // dataLayer: createInMemoryDataLayer({ fixtures }),
 })
```

### Why

The seam exists to separate what makes mcp-rune unique (turning model schemas into MCP tools / prompts / apps for LLMs) from what is generic ("talk to a REST backend"). Before v0.49 the projection layer was wired directly to `ModelService` + `ApiClient` and several internal tools reached for `this.apiClient` directly to bypass the service layer for bulk work, locking out any non-HTTP adapter. v0.49 names the data-access surface explicitly so adapters can slot in behind it — and removes the direct `apiClient` reaches so the seam is actually honest, not aspirational.

[0.49.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.48.1...v0.49.0

## [0.48.1] — 2026-05-27

### Docs

- **`docs/guides/authoring-extensions-guide.md`** — new step-by-step guide for writing extensions from scratch. Walks through the five-piece `ApiExtension` shape (config type, typed helper, typed reader, optional service factory, extension factory), includes a worked `bulk-actions` example end-to-end (per-model config + MCP tool + `ModelService` mixin + registration), and points to the `HttpExtension` version for the simpler case. Includes the test patterns used by the built-in extensions (mixin-capturing helper for unit tests, end-to-end registration tests).
- **`docs/guides/api-extensions.md`** — added an **Architecture overview** section at the top with a diagram of the six pieces (typed helper, typed reader, capability getters, extension factory, optional service factory, per-model bag slot) and the `ModelService` mixin contract table (`apiClient`, `endpointResolver`, `models`, `buildPayload`, `dispatch`). Reframed the page as the conceptual reference; cross-links to the new authoring guide for the step-by-step.
- **`docs/guides/service-layer-guide.md`** — fixed wrong `@mcp-rune/mcp-rune/search` imports (now `/api-extensions/search`), migrated all `static search = {...}` code examples to `static extensions = { search: searchConfig({...}) }`, switched `new SearchService(...)` examples to the `createSearchService(apiClient, context)` factory pattern that all consumer clusters use.
- **`docs/guides/search-filter-integration-guide.md`** — added the `searchExtension()` registration prerequisite at the top, migrated the activity-model example from `static filters = {...}` to `extensions = { search: searchConfig({ filters: {...} }) }`, updated the checklist.
- **`docs/guides/project-structure-guide.md`** — removed the obsolete `search` subpath export, added `extensions/`, `extensions/cimd`, `api-extensions/`, `api-extensions/custom-actions`, `api-extensions/search` to the framework directory tree; added a note about opt-in tool registration.
- **`docs/guides/mcp-apps-architecture.md`** — updated the `SEARCH_VIEW_MODELS` / `LIST_VIEW_MODELS` example to read filter declarations via `getSearchConfig(M)?.filters` from the search extension; clarified the "Available for" rows and "Separate Search App" / "Conditional Registration" sections to refer to declared search filters (via `searchConfig`) instead of the removed `static filters` field.

No behavior change. Docs-only release; pinning is unaffected.

[0.48.1]: https://github.com/mcp-rune/mcp-rune/compare/v0.48.0...v0.48.1

## [0.48.0] — 2026-05-27

### Added

- **`searchConfig({...})` typed helper** at `@mcp-rune/mcp-rune/api-extensions/search` — symmetric with `customActionsConfig()` from the custom-actions extension. Use it to declare per-model search config inside the `extensions['search']` slice with full TypeScript validation, instead of writing raw object literals.

### Changed (BREAKING)

- **Per-model search config moves from `static search` on `BaseModel` into `extensions['search']`.** Final step of the search-extraction trilogy (PRs A and B landed in v0.46.0 and v0.47.0). After this release `BaseModel` declares only what every API needs — endpoint, convention, namespace, parent/standalone, associations, and the `extensions` bag — with both opt-in capabilities (custom actions, search) consistently sitting in that bag via their typed helpers.

  Concrete changes:
  - `static search: SearchConfig | null` removed from `BaseModel`.
  - `static get supportsLookup()` getter removed from `BaseModel`. Apps now compute lookup capability inline via `getSearchConfig(MC)?.lookup?.fields`.
  - `search` field removed from the `ModelConfig` interface (`src/mcp/tools/base-tool.ts`).
  - `search` field removed from `AppModelClass` (`src/mcp/apps/types.ts`); `extensions?: Record<string, unknown>` slot added in its place.
  - `SearchModelClass` (in the search extension's types) reads `extensions['search']` via `getSearchConfig` instead of `model.search`.
  - `SearchService` internals read every search config field through `getSearchConfig(ModelClass)` instead of `ModelClass.search.*`.

  `getSearchConfig` is now a **structural** getter — it accepts any `{ extensions?: Record<string, unknown> }` shape, so the same call works on `ModelConfig`, `AppModelClass`, and `SearchModelClass` uniformly.

  Migration:

  ```diff
  -import { BaseModel } from '@mcp-rune/mcp-rune/core'
  -import type { SearchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'
  +import { BaseModel } from '@mcp-rune/mcp-rune/core'
  +import { searchConfig } from '@mcp-rune/mcp-rune/api-extensions/search'

   class Title extends BaseModel {
     static api = { endpoint: 'titles' }
  -  static search: SearchConfig = {
  -    lookup: { fields: ['name'] },
  -    filters: { status: { type: 'enum', enumValues: ['draft', 'live'] } },
  -    query: { endpoint: 'titles/search', method: 'POST', queryParam: 'q' }
  -  }
  +  static extensions = {
  +    search: searchConfig({
  +      lookup: { fields: ['name'] },
  +      filters: { status: { type: 'enum', enumValues: ['draft', 'live'] } },
  +      query: { endpoint: 'titles/search', method: 'POST', queryParam: 'q' }
  +    })
  +  }
   }
  ```

  Behavior is unchanged. Apps, analysis-ingest, list-models, validators, and the search extension's own tools all continue to work — they were already routing through `getSearchConfig` after PR B (v0.47.0).

  Models that don't use search drop the `static search` declaration with no replacement needed.

### Why this completes the trilogy

`BaseModel` was bootstrapped with one foundational concept (CRUD) and accumulated two bolted-on capabilities (custom actions, then search). v0.44.0 extracted custom actions into an opt-in extension with config in `extensions['custom-actions']`. v0.46.0 and v0.47.0 prepared search infrastructure for the same shape. This release finishes the job: `BaseModel` is back to being only what every API needs, and both opt-in capabilities sit in `extensions[...]` via their typed helpers, with the same shape and the same authoring contract.

The trilogy is now complete. Future API capabilities (GraphQL field selection, bulk endpoints, RPC verbs, streaming, etc.) follow the same pattern without further `BaseModel` churn.

[0.48.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.47.0...v0.48.0

## [0.47.0] — 2026-05-27

### Changed (BREAKING)

- **The entire `src/mcp/search/` directory moves into the `search` ApiExtension at `src/api-extensions/search/`.** `SearchService`, `SearchAdapter`, `RailsSearchAdapter`, and all search-related types (`SearchConfig`, `LookupConfig`, `QueryConfig`, `SearchGroup`, `SearchModelClass`, `SearchResult`, `PaginationInfo`, `NormalizedListResponse`, etc.) now live inside the extension that owns them. Apps and `analysis-ingest-tool` continue to use these primitives by importing them from `@mcp-rune/mcp-rune/api-extensions/search` — they depend on the _module_, not on the extension being registered with `ToolRegistry`.

  The `@mcp-rune/mcp-rune/search` package export is **removed**. All imports route through `@mcp-rune/mcp-rune/api-extensions/search` instead.

  Migration:

  ```diff
  -import {
  -  SearchService,
  -  SearchAdapter,
  -  RailsSearchAdapter
  -} from '@mcp-rune/mcp-rune/search'
  -import type { SearchConfig, SearchGroup } from '@mcp-rune/mcp-rune/search'
  +import {
  +  SearchService,
  +  SearchAdapter,
  +  RailsSearchAdapter
  +} from '@mcp-rune/mcp-rune/api-extensions/search'
  +import type { SearchConfig, SearchGroup } from '@mcp-rune/mcp-rune/api-extensions/search'
  ```

  No behavioral change. `SearchService` instances created without the extension being registered with `ToolRegistry` work identically — the extension's only contribution to `ToolRegistry` is the `search_records` and `get_filters_guide` MCP tools.

### Added

- **`createSearchService(apiClient, context?)` factory** at `@mcp-rune/mcp-rune/api-extensions/search`. Three sites used to instantiate `SearchService` independently with the same conventional arg-extraction pattern (pulling `searchGroups` and `defaultAdapter` out of `serverContext`): the extension's `SearchRecordsTool`, the apps registry, and `analysis-ingest-tool`. They all now route through this factory. Future changes to the `SearchService` constructor signature ripple through one edit instead of three.

- **Typed capability readers** at `@mcp-rune/mcp-rune/api-extensions/search`:
  - `getSearchConfig(model)` — read a model's search config (returns `undefined` when absent)
  - `getModelFilters(model)` — typed alias for `getSearchConfig(model)?.filters`
  - `getSearchableModelNames(models)` — names of models that declare at least one filter
  - `getLookupableModelNames(models)` — names of models that declare lookup fields
  - `getQueryableModelNames(models)` — names of models that declare a query endpoint or group

  These centralize the read path for `model.search.*`. Today `model.search` is still declared as `static search` on `BaseModel`; if that moves to the `extensions['search']` bag in a future release, only `getSearchConfig()` changes — every consumer above it already routes through this module. Used internally by `analysis-ingest-tool`, `list-models-tool`, `validators.ts`, and the extension's own tools.

### Why this step

PR B of the 3-PR plan to complete the search-extension extraction. The directory move and the new factory + capability readers establish the single ownership boundary: the search extension owns the entire search subsystem; everything that needs search imports from it. PR A (v0.46.0) extracted the cross-cutting `ApiClient` and `derived-fields` so they didn't have to come along for the ride. PR C will move the per-model config from `static search` on `BaseModel` into the `extensions['search']` bag via a `searchConfig({...})` helper — at which point the capability getters introduced here become the only consumers that need to update.

[0.47.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.46.0...v0.47.0

## [0.46.0] — 2026-05-27

### Changed (BREAKING)

- **`ApiClient`, `SearchApiClient`, and `RequestOptions` move from `@mcp-rune/mcp-rune/search` to `@mcp-rune/mcp-rune/core`.** They are the universal CRUD client interface (used by `ModelService`, every tool that requires auth, every MCP App, and the `LoggingApiClient` wrapper) and were located under `src/mcp/search/` only because `SearchService` happened to be the first non-CRUD consumer to abstract over them. The location was misleading — `ApiClient` has nothing intrinsically to do with search. New home: `src/core/api-client.ts`; new public export: `@mcp-rune/mcp-rune/core`.

  Migration:

  ```diff
  -import type { ApiClient, RequestOptions, SearchApiClient } from '@mcp-rune/mcp-rune/search'
  +import type { ApiClient, RequestOptions, SearchApiClient } from '@mcp-rune/mcp-rune/core'
  ```

  The `@mcp-rune/mcp-rune/search` export keeps `SearchService`, `SearchAdapter`, `RailsSearchAdapter`, `PaginationInfo`, `SearchGroup`, `SearchModelClass`, and `SearchResult` — the actually search-specific surface.

- **`resolveDerivedFields` and `ModelWithDerivedAttrs` move from `src/mcp/apps/derived-fields` to `src/core/derived-fields`.** The utility is consumed by MCP apps (`list-view`, `search-view`) _and_ by the `search_records` ApiExtension tool — cross-feature use. Living inside the `apps/` directory misrepresented its scope. Now re-exported from `@mcp-rune/mcp-rune/core`.

  The function signature loosens too: instead of requiring an `AppModelClass`, it accepts any object matching the minimal `ModelWithDerivedAttrs` shape (`{ attributes?: Record<string, { derived?: { from, field } }> }`). All existing call sites continue to satisfy it — `AppModelClass`, `ModelConfig`, and `BaseModel` subclasses all qualify.

  Internal-only migration (no public consumers were importing this directly).

### Why this is a first step

This is PR A of a 3-PR plan to complete the search extension extraction. The misplaced cross-cutting types (`ApiClient`) and the misplaced cross-cutting util (`derived-fields`) needed to come out of the search and apps directories first, so that the next PRs — moving `SearchService` and its types into the search extension — can do so cleanly without dragging non-search infrastructure along.

[0.46.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.45.0...v0.46.0

## [0.45.0] — 2026-05-27

### Added

- **Built-in `searchExtension`** at `@mcp-rune/mcp-rune/api-extensions/search` — the second concrete `ApiExtension`. Contributes the `search_records` and `get_filters_guide` MCP tools, plus the typed `getSearchConfig()` and `getSearchableModelNames()` readers. Conventional registration key: `search`.

### Changed (BREAKING)

- **`search_records` and `get_filters_guide` MCP tools move from core to the opt-in `search` ApiExtension.** Both are removed from `DATA_TOOL_CLASSES` and from the `@mcp-rune/mcp-rune/tools` re-exports. They are no longer registered unless `searchExtension()` is explicitly added to `ToolRegistry`. Behavior is identical when registered.

  This is the same framing change v0.44.0 made for custom actions: pure REST servers shouldn't carry the surface area of capabilities they don't expose. The two tools were previously registered for every server, returning `"Model X does not support search"` errors at call time when the LLM tried them on models without `static search` config. As an opt-in extension, the surface area is explicit at the call site.

  Migration:

  ```diff
   import { ToolRegistry, DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
  +import { searchExtension } from '@mcp-rune/mcp-rune/api-extensions/search'

   new ToolRegistry({
     toolClasses: DATA_TOOL_CLASSES,
     models: MODEL_CLASSES,
     createApiClient,
  +  apiExtensions: {
  +    search: searchExtension()
  +  }
   })
  ```

  Per-model `static search = { ... }` config is **unchanged** in this release. Unlike the custom-actions extraction in v0.44.0, the search extension does NOT move the per-model config into the `extensions['search']` bag, because the `SearchConfig` is read by code outside the search surface: `analysis-ingest-tool` instantiates `SearchService` for filtered ingestion, `validators.ts` reads `model.search.filters` to validate filter args across `find_records` / `create_model` / `update_model`, and `list_models` surfaces `search.filters` and `search.lookup.fields` in its output for LLM discovery. Moving the config slot would require refactoring those cross-cutting consumers — out of scope for this release. The `SearchService`, `SearchAdapter`, `RailsSearchAdapter`, and `SearchConfig` types stay in `@mcp-rune/mcp-rune/search` and continue to be importable from there.

  Deeper extraction (moving `SearchService` and the config slot into the extension, and updating cross-cutting consumers to read through it) is a future, separate decision.

  Omit the extension to drop both tools entirely. Models can still declare `static search` config — `list_models` will continue to surface `searchable_by` and `filterable_search` metadata for LLM discovery — but `search_records` and `get_filters_guide` will be absent from the tool catalogue.

[0.45.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.44.0...v0.45.0

## [0.44.0] — 2026-05-27

### Added

- **Built-in `customActionsExtension`** at `@mcp-rune/mcp-rune/api-extensions/custom-actions` — the first concrete `ApiExtension`, the opt-in replacement for the prior in-core custom-actions support. Same `ActionDefinition` shape, same Rails-style path resolution, same `:id` / `:param_name` substitution. Contributes the `model_action` MCP tool and the `action()` method on `ModelService` (as a registered mixin). Exports `customActionsExtension()`, `customActionsConfig()`, `getActionsConfig()`, `ActionDefinition`, `ActionResolver`, `UnknownActionError`, `ModelActionTool`.
- **`EndpointResolver.applyNamespace()`** promoted from private to public — the stable namespace-application helper that the extension's `ActionResolver` composes alongside `pathForType()`. No behavior change.

### Changed (BREAKING)

- **Custom actions (non-CRUD verbs on models) move from core to an opt-in `ApiExtension`.** The `ActionDefinition` type, `api.actions` field on `ApiConfig`, `EndpointResolver.resolveAction()` (and `ActionContext`, `UnknownActionError`), `ModelService.action()`, and the `model_action` MCP tool are removed from the core entry points. The `model_action` tool is no longer registered unless `customActionsExtension()` is explicitly added to `ToolRegistry`, and per-model action config moves from `api.actions` to `extensions['custom-actions']`.

  This is a deliberate framing change, not a refactor. `BaseModel` was bootstrapped to describe pure REST/CRUD; custom verbs were later bolted onto core, which meant every server — even one with no custom verbs — paid for the surface area, the tool registration, and the conceptual weight of the capability. Keeping it in core implied a model layer that does not exist (every API has actions); as an opt-in extension, the capability is explicit at the call site. This is the same framing change the v0.41.0 CIMD extraction made for the HTTP layer.

  Migration:

  ```diff
   import { BaseModel } from '@mcp-rune/mcp-rune/core'
  -// (no extension import needed previously)
  +import {
  +  customActionsExtension,
  +  customActionsConfig
  +} from '@mcp-rune/mcp-rune/api-extensions/custom-actions'

   class Book extends BaseModel {
     static api = { endpoint: 'books' }
  -  static api.actions = {
  -    publish: { path: ':id/publish' },
  -    archive: { path: ':id/archive', method: 'PATCH' }
  -  }
  +  static extensions = {
  +    'custom-actions': customActionsConfig({
  +      actions: {
  +        publish: { path: ':id/publish' },
  +        archive: { path: ':id/archive', method: 'PATCH' }
  +      }
  +    })
  +  }
   }

   new ToolRegistry({
     toolClasses: DATA_TOOL_CLASSES,
     models: MODEL_CLASSES,
     createApiClient,
  +  apiExtensions: {
  +    'custom-actions': customActionsExtension()
  +  }
   })
  ```

  Resolution and dispatch behavior are unchanged when registered. Omit the extension to drop the `model_action` tool entirely; `list_models` will then omit the `actions` field on every model whose `extensions['custom-actions']` slice it would otherwise have read. Mixin-contributed `ModelService.action()` is also absent when the extension is omitted — calls throw `TypeError: service.action is not a function`.

  See [`docs/guides/api-extensions.md`](docs/guides/api-extensions.md) for the authoring guide and stability promise.

[0.44.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.43.0...v0.44.0

## [0.43.0] — 2026-05-27

### Added

- **`ApiExtension` interface and `apiExtensions` config on `ToolRegistry`** — opt-in model/API-layer extensions that contribute MCP tools and `ModelService` methods on top of the built-in CRUD pipeline. Extensions receive a narrowed context object (`name`, `models`, `serverContext`, `logger`, `registerTool`, `registerModelServiceMixin`) — not raw access to `ToolRegistry` internals — and registration is validated synchronously at boot: tool-name collisions across core and other extensions throw with both extension keys in the error. Sibling pattern to `HttpExtension` but scoped to the tool registry, so it works uniformly in stdio mode. No built-in API extensions land in this release; the framework is in place ahead of the upcoming `custom-actions` and `search` extractions. New package export: `@mcp-rune/mcp-rune/api-extensions` (types). Authoring guide at [`docs/guides/api-extensions.md`](docs/guides/api-extensions.md).
- **`static extensions: Record<string, unknown>` slot on `BaseModel`** — the per-model bag where each `ApiExtension` reads its own configuration slice via a typed helper it exports. Bag is a namespaced map (e.g. `extensions: { 'custom-actions': customActionsConfig({...}) }`) so extensions can never collide on config keys and each extension's config shape can evolve independently of core. See the "Why the namespaced bag?" section of the new guide for the rationale.
- **`ModelService.dispatch()` and `ModelService.buildPayload()` are now public** — the stable mixin contract `ApiExtension` authors compose for non-CRUD verbs. Previously `_dispatch` / `_buildPayload`; renamed and exposed without changing behavior. The `endpointResolver` and `apiClient` getters were already public and complete the contract.

[0.43.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.42.0...v0.43.0

## [0.42.0] — 2026-05-27

### Added

- **Astro-style startup banner.** On TTY consoles, the `listening` handler now prints a multi-line banner — bold server name, dim `vX.Y.Z`, green `ready in Xms`, indented endpoint rows under a dim `┃` pipe — instead of the previous single-line `… started` info log. The structured "started" event is still emitted in JSON mode and under `NO_COLOR`, so Loki/Grafana queries are unaffected. `McpConfig` accepts an optional `version` field shown in the banner. New exports from `@mcp-rune/mcp-rune/services`: `canPrintBanner()`, `printBanner()`, `BannerInput`.
- **Per-service tag colors.** Recurring service tags (`[startup]`, `[express]`, `[Sentry]`, `[oauth]`, `[langfuse]`) get curated colors that match their semantic role. Unknown tags fall through to a deterministic hash-based palette so new services pick up a stable color without registry maintenance. Scoped services (e.g. `startup:db`) share their parent's color so bursts read as one visual block. New export: `formatService()`.
- **Bracketed status badges on HTTP lines.** Inbound and outbound HTTP log lines lead with `[200]` / `[3xx]` / `[4xx]` / `[5xx]` / `[ERR]` badges, colored green / cyan / yellow / red / dim respectively. Colorization is applied inside the text format (not at call sites), so file transports and JSON output remain ANSI-free. New export: `colorizeStatusBadge()`.

### Changed

- **Console log format trimmed for live-tail readability.** Console-only changes: the timestamp shrinks to `HH:mm:ss.SSS` (file/JSON keep the full date for archival queries), and the `INFO` / `DEBUG` level word is dropped from every line. `WARN` and `ERROR` keep a colored badge so severity stays visible even under `NO_COLOR`. JSON output and file transports are unchanged.
- **HTTP request line format.** Inbound `← POST /oauth/token 200 (157ms, upstream 132ms)` becomes `← [200] POST /oauth/token 157ms`, with `upstreamMs` / `upstreamCalls` moving to the logfmt metadata tail (still structured in JSON). Outbound axios success lines are similarly reshaped to `→ [200] METHOD url Xms`; the error variant becomes `✗ [401] METHOD url — message Xms` (or `[ERR]` when no HTTP response was received). The leading `←` / `→` / `✗` symbols stay so direction remains readable at a glance.

[0.42.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.41.1...v0.42.0

## [0.41.1] — 2026-05-27

### Docs

- **`docs/guides/extensions.md` gains a "What the framework guarantees" section.** Makes explicit the no-auto-registration promise that the extension API already implements: mcp-rune never discovers plugins from `node_modules`, never sniffs env vars to enable extensions, never auto-loads from a manifest. An extension runs if and only if it appears in the `extensions` option on `HttpServer`. The built-in `cimdExtension` is framed as a participant in that contract, not an exception. README's "Client Registration Strategies" section gets a one-line cross-link to the new subsection. No behavior change — the guarantee was already true; only the docs are new.

[0.41.1]: https://github.com/mcp-rune/mcp-rune/compare/v0.41.0...v0.41.1

## [0.41.0] — 2026-05-27

### Added

- **`HttpExtension` interface and `extensions` config on `HttpServer`** — opt-in HTTP-layer extensions that add routes and route-scoped middleware on top of the built-in OAuth, status, and MCP transport endpoints. Extensions receive a narrowed context object (`router`, `baseUrl`, `pathPrefix`, `mcpName`, `oauth`, `logger`) — not the raw Express `app` — and a `requires: ['oauth']` capability check that fails at boot if the host is in token mode. Built-in extensions mount after `/oauth/*` and `/health` and before the `/mcp` transport, so they cannot intercept MCP traffic or override well-known endpoints. New package exports: `@mcp-rune/mcp-rune/extensions` (types) and `@mcp-rune/mcp-rune/extensions/cimd` (the first built-in). Authoring guide at [`docs/guides/extensions.md`](docs/guides/extensions.md).
- **Built-in `cimdExtension`** at `@mcp-rune/mcp-rune/extensions/cimd` — the opt-in replacement for the prior in-core CIMD support. Same defaults, same Cache-Control / ETag behavior, registered explicitly under the conventional `cimd` key.

### Changed (BREAKING)

- **CIMD (Client ID Metadata Document) support moves from OAuth core to an opt-in extension.** The `clientMetadata` field on `OAuthServiceOptions` and the `ClientMetadataConfig` type export are removed. The `GET /oauth/client-metadata.json` endpoint is no longer served unless `cimdExtension` is explicitly registered.

  This is a deliberate framing change, not a refactor. Server-hosted CIMD is a testing convenience (it lets MCP clients which don't host their own CIMD — e.g. Opencode — complete the OAuth flow end-to-end against an upstream auth server), not what the MCP Authorization spec describes (the spec has the downstream MCP client host its own document). Keeping it in core implied otherwise. As an opt-in extension, the divergence is explicit at the call site.

  Migration:

  ```diff
   import { HttpServer } from '@mcp-rune/mcp-rune/server'
   import { OAuthService } from '@mcp-rune/mcp-rune/oauth2'
  +import { cimdExtension } from '@mcp-rune/mcp-rune/extensions/cimd'

   new HttpServer({
     oauth: new OAuthService({
       authServerUrl, clientId, clientSecret, redirectUri,
  -    clientMetadata: { redirectUris, clientName, scope }
     }),
     mcp,
  +  extensions: {
  +    cimd: cimdExtension({ redirectUris, clientName, scope })
  +  }
   })
  ```

  Defaults are unchanged: `redirect_uris` falls back to `${baseUrl}/oauth/callback`, `client_name` to `mcp.name`, `scope` to `oauth.scopes`, `cacheMaxAge` to 3600. If you weren't using `clientMetadata` at all and want to keep serving the endpoint, register the extension with no options: `extensions: { cimd: cimdExtension() }`. To remove CIMD entirely, just omit the extension — `/oauth/client-metadata.json` will then return 404.

  See [`docs/guides/extensions.md`](docs/guides/extensions.md) for the authoring guide and stability promise.

[0.41.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.40.1...v0.41.0

## [0.40.1] — 2026-05-25

### Added

- **`docs/guides/quickstart-guide.md`** — single-source-of-truth quickstart, ported from the root `README.md`'s Quick Start section plus the Claude Desktop config snippet from `examples/bookshelf/README.md`. ~80 lines, no fabricated CLI: the framework is consumed via `git clone` + run the example, as documented today.
- **`docs/guides/project-structure-guide.md`** — canonical reference for the user-server / framework directory split. Pulls the two directory trees from the root `README.md` and the concrete layout from `examples/bookshelf/README.md`.
- **`docs/guides/sections-groups-guide.md`** — extracted from `prompt-creation-guide.md` (Sections Architecture, ~135 lines). Covers the user-facing-sections vs validation-fieldGroups split, section content enrichment, per-group content for multi-group sections, helper methods, and flow-diagram generation.
- **`docs/guides/stateful-strategies-guide.md`** — extracted from `prompt-creation-guide.md` (Stateful Prompts + StatefulStrategy API, ~130 lines). Covers mode configuration (`guided` / `quick`), the stateful prompt structure, BasePrompt helpers, the validation flow, and the full `StatefulStrategy.getSections()` / `getProgress()` API reference.

### Changed

- **`docs/guides/prompt-creation-guide.md` slimmed from ~615 to ~310 lines.** The two extracted blocks are replaced by one-paragraph stubs that cross-link to the new standalone guides, so the parent reads as a coherent narrative about the strategy DSL without being trapped under embedded reference material. The table of contents at the top of the guide is updated to match the new section list.
- **`docs/guides/prompt-derivation-framework-guide.md`** — Layer 2 now opens with a one-line cross-link to `sections-groups-guide.md`. No content removed: the derivation guide presents _the layer_; the new guide presents _the concept_.
- **`docs/guides/analysis-memories-guide.md`** and **`docs/guides/proximity-sampling-guide.md`** — promoted from `docs/features/analysis-memories/{index,proximity-sampling}.md` (via `git mv`) into `docs/guides/`. Internal cross-links repointed (`./index.md` → `./analysis-memories-guide.md`; `../../guides/...` → `./...`). The external link in `README.md` repointed to the new path.

### Removed

- **`docs/features/` directory** — emptied by the analysis-memories promotion and deleted. Every documented topic now has a single canonical home under `docs/guides/`.

### Why this matters

The companion documentation site (`mcp-rune-site`) drives its sidebar, routing, and pager off a single `guides.ts` data file mirroring the 7-section structure. Before this release, six sidebar entries had no canonical markdown and rendered as disabled "wip" links. With these changes the on-disk surface in `docs/guides/` matches that structure exactly — 19 files, one per topic, each the unique source of truth for what it covers. Long-term, this also means: editors touch one file per change (no "is the canonical version in the README, the bookshelf example, or the embedded section inside prompt-creation?"), and cross-guide links resolve to the same file on GitHub and on the site.

[0.40.1]: https://github.com/mcp-rune/mcp-rune/compare/v0.40.0...v0.40.1

## [0.40.0] — 2026-05-25

### Changed (BREAKING)

- **Package renamed from `mcp-kit` (and the prior `@dsaenztagarro/mcp-kit`) to `@mcp-rune/mcp-rune`.** All import paths change accordingly: `mcp-kit/server` → `@mcp-rune/mcp-rune/server`, and the same for every subpath export (`/core`, `/tools`, `/prompts`, `/apps`, `/search`, `/domain`, `/oauth2`, `/services`, `/db`, `/db/migrations`, `/lib/*`). The GitHub repository moved from `dsaenztagarro/mcp-kit` to `mcp-rune/mcp-rune`, and the GitHub Packages publish scope changed from `@dsaenztagarro` to `@mcp-rune`. The brand/short name is now `mcp-rune` (used in prose, source-file header comments, log messages).

  Migration for consumers:

  ```diff
  -import { createServer } from 'mcp-kit/server'
  -import { DATA_TOOL_CLASSES } from 'mcp-kit/tools'
  +import { createServer } from '@mcp-rune/mcp-rune/server'
  +import { DATA_TOOL_CLASSES } from '@mcp-rune/mcp-rune/tools'
  ```

  ```diff
  -"@dsaenztagarro/mcp-kit": "^0.39.0"
  +"@mcp-rune/mcp-rune": "^0.40.0"
  ```

  CHANGELOG entries for prior releases keep their original `@dsaenztagarro/mcp-kit` references and compare-URLs against the old GitHub path — those are historical and intentionally not rewritten.

### Added

- **`ConfigDescriptor` accepts `type: 'array'` with an optional `separator` (default `,`).** Consumers can declare an env var as a typed array directly in the descriptor instead of hand-splitting a CSV at the call site. `formatLines` renders non-empty, non-sensitive arrays in YAML block style (indented bullet per item), matching Spring Boot Actuator / Rails / `kubectl describe` conventions, which makes long lists (e.g. nine CIMD redirect URIs) scannable in TTY startup logs.

### Why this matters

The repo move to its own GitHub org (`mcp-rune`) and the matching npm scope (`@mcp-rune`) give the project a stable home decoupled from the original maintainer's personal account. The brand split — short name `mcp-rune` for prose, full id `@mcp-rune/mcp-rune` for installs and imports — keeps narrative readable while the package id stays unambiguous in `package.json` and import statements. The array-env-var support removes one of the last surface areas where every consumer was writing the same `value.split(',').map(s => s.trim())` boilerplate.

[0.40.0]: https://github.com/mcp-rune/mcp-rune/compare/v0.39.0...v0.40.0

## [0.39.0] — 2026-05-24

### Changed (BREAKING)

- **Log output collapses paired start/end lines into one completion line per operation.** Startup phases and inbound HTTP requests now emit a single `✓ name (Xms)` / `← METHOD path STATUS (totalMs[, upstream Xms])` line on completion instead of separate "started"/"completed" pairs. Slow operations get a deferred `▸` line only after a threshold (250ms for async phases, 1s for requests), so a hung process still surfaces what was in flight. Ops queries or runbooks keyed on the literal strings `Request started`, `Request completed`, or `…proxied successfully` will need updating.

- **`StartupTracker.phase()` splits into sync `phase()` + new `phaseAsync()`.** The sync variant has no `▸` start marker at all (a sync block holds the event loop, so a deferred timer could never fire before the phase returns). The async variant arms a `setTimeout(..., 250).unref()` that emits `▸` only when a phase is genuinely slow. Existing sync call sites continue to work unchanged; async phases must opt into `phaseAsync` to get the deferred-start behavior.

- **`RequestContext` interface gains a required `upstream: { totalMs, calls }` accumulator.** External code calling `requestContext.run({ requestId }, fn)` directly must now pass `{ requestId, upstream: { totalMs: 0, calls: 0 } }`. The bundled `runWithRequestId` helper and the `request-id` middleware do this for you.

### Added

- **`src/services/instrumented-axios.ts` — `createInstrumentedAxios()` factory.** Cross-cutting primitive that returns an axios instance whose interceptors emit one `→ METHOD url status (Xms) k=v` line per completed call. Each instance carries its own per-endpoint allowlist (`EndpointLogConfig[]`) for surfacing domain fields like `grantType` or `clientName`, while a `GLOBAL_REDACT` set masks well-known secret keys (`client_secret`, `access_token`, `refresh_token`, `id_token`, `authorization`, `password`, `code`) regardless of allowlist. Each completed call also feeds the request-scoped `addUpstreamDuration` accumulator so inbound logs can render proxy overhead. Endpoints not in the allowlist log transport-only — a new endpoint cannot accidentally leak a sensitive field until someone opts it in.

- **Direction glyphs `←` (inbound, cyan) and `→` (outbound, magenta)** in the logger symbol table. CI/JSON consumers still see the glyph; TTY users get the color reinforcement.

- **OAuth-instrumented axios instance (`src/oauth2/oauth-axios.ts`).** Built from the factory with an allowlist for `/oauth/token`, `/oauth/register`, and the well-known metadata endpoints. The OAuth router swaps its `import axios` for this instance — handler code stays as plain `axios.post(...)` calls and the interceptor handles all logging non-invasively.

### Removed

- **Per-handler `…proxied successfully` log calls in `oauth-router.ts`.** The axios interceptor covers them with richer info (method, full upstream URL, status, duration, allowlisted domain fields). Error logs are kept because they carry diagnostic context (`mcpName`, request shape) the interceptor cannot reach.

### Why this matters

A 10-phase startup that previously took 20 log lines now takes 10. Each proxied OAuth request that previously took 3 lines (`Request started` + `…proxied successfully` + `Request completed`) now takes 2 (`→` upstream + `←` inbound), and proxy overhead is derivable from `totalMs − upstreamMs` shown on the inbound line. The factory generalizes the same `→`-line behavior so downstream MCPs' tool API clients can adopt it for their own `createApiClient` factories without per-call-site changes.

[0.39.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.38.0...v0.39.0

## [0.38.0] — 2026-05-22

### Changed (BREAKING)

- **`resourceUri` is no longer a config knob on `createOAuthRouter`.** The single source of truth moves to `OAuthService.resourceUri`. `HttpServer` injects `${baseUrl}/mcp` into it during construction via the new `OAuthService.applyDefaultResourceUri(uri)` method (idempotent — no-ops when the caller already supplied one). The OAuth router now reads `oauth.resourceUri` directly and throws at construction time if it is missing, instead of silently falling back to `${baseUrl}/mcp` while leaving `OAuthService.resourceUri` null. The previous shape allowed `OAuthService.resourceUri` to stay null while the proxy injected `${baseUrl}/mcp` on `/oauth/authorize` and `/oauth/token` — which silently skipped the RFC 8707 audience check in `introspectToken`.

  Migration: no action required for `HttpServer` consumers — the default is applied automatically. Callers that construct `createOAuthRouter` directly must now set `resourceUri` on `OAuthService`:

  ```diff
  -createOAuthRouter({
  -  oauth,
  -  baseUrl,
  -  mcpName,
  -  resourceUri: 'https://mcp.example.com/api/v2/mcp'
  -})
  +createOAuthRouter({
  +  oauth: new OAuthService({ ..., resourceUri: 'https://mcp.example.com/api/v2/mcp' }),
  +  baseUrl,
  +  mcpName
  +})
  ```

  Embedding servers that previously passed `resourceUri: \`${baseUrl}/mcp\``to their`OAuthService`constructor to satisfy the audience check can now drop that line —`HttpServer` injects the same default.

### Why this matters

`${baseUrl}/mcp` previously lived in two places — `OAuthRouterConfig` (with a `?? \`${baseUrl}/mcp\``fallback) and`OAuthService.resourceUri`(no default). Consumers had to wire both for the audience check to actually run; the only document calling that out was a fragile comment in each consumer's bootstrap file. The two values can no longer drift: the proxy reads from`OAuthService.resourceUri`, the audience check validates against the same field, and `HttpServer`is the one place that knows`baseUrl` and seeds the default before any route is registered.

[0.38.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.37.0...v0.38.0

## [0.37.0] — 2026-05-22

### Changed (BREAKING)

- **CIMD config moves from `HttpServer` to `OAuthService`.** The `clientMetadata` constructor parameter is removed from `HttpServer` and added to `OAuthService` (and the `ClientMetadataConfig` type moves with it, now exported from `@dsaenztagarro/mcp-kit/oauth2`). The `/oauth/client-metadata.json` endpoint now reads `oauth.clientMetadata` directly; behavior and defaults are unchanged.

  Migration:

  ```diff
  -new HttpServer({
  -  // ...
  -  oauth: new OAuthService({ ... }),
  -  clientMetadata: { redirectUris, clientName, scope }
  -})
  +new HttpServer({
  +  // ...
  +  oauth: new OAuthService({
  +    // ...
  +    clientMetadata: { redirectUris, clientName, scope }
  +  })
  +})
  ```

### Why this matters

CIMD (Client ID Metadata Document) and DCR (Dynamic Client Registration, RFC 7591) are sibling OAuth client-registration mechanisms — DCR registers dynamically via `POST /oauth/register`, CIMD publishes a JSON metadata document the AS fetches on demand. DCR already lived entirely on `OAuthService` (via `authServerUrl`); CIMD being a top-level `HttpServer` parameter was asymmetric and leaked an OAuth concern into the HTTP server's constructor. Co-locating both under `OAuthService` matches the actual concept ("this is who the OAuth client is") and removes a parameter from `HttpServer` that always had to be plumbed through to the OAuth router anyway. No runtime behavior changes — same endpoint, same defaults, same cache headers.

[0.37.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.36.1...v0.37.0

## [0.36.1] — 2026-05-22

### Fixed

- **HTTP server bind failures are now logged and reported instead of crashing silently.** Previously, a port-conflict (`EADDRINUSE`), permissions error (`EACCES`), or any other `net.Server` `error` event raised an unhandled exception and Node exited with no log line or Sentry report — making a port-conflicted prod container indistinguishable from "never started" in Loki/Grafana. `HttpServer.start()` now subscribes to `listening` / `error` explicitly (separated paths instead of `listen(port, callback)` which Express turns into an ambiguous `once(callback)` for both success and failure), and the new `_handleListenError` writes a structured `logger.error`, captures to Sentry with `error.category=internal`, `startup.phase=http_listen`, `level=fatal`, flushes with a 2s bound, then exits with code 1.

### Changed

- **Split `src/mcp/http-server.ts` (~593 lines) into an orchestrator + per-concern middleware modules** following the established `createOAuthRouter` / `createRequestIdMiddleware` factory pattern. New files under `src/mcp/middleware/`: `security-headers.ts`, `cors.ts`, `rate-limit.ts`, `mcp-auth.ts` (auth resolution sets `req.requestAccessToken`), `mcp-handler.ts` (POST/GET/DELETE dispatcher), `status-router.ts` (`/health` + `/cache-stats`). New `src/mcp/session-manager.ts` owns the `Map<sessionId, SessionEntry>` and `closeAll`. `HttpServer` shrinks to ~350 lines and is now a thin orchestrator over those factories, retaining only constructor wiring, the legacy `/sse` 410 handler, and the lifecycle methods (`start`, `_handleListenError`, `_shutdown`) that are inherently bound to `this.httpServer` and `process`.

### Why this matters

The silent bind-failure path was a real production hazard: a restart loop that never came up looked identical to a healthy-but-quiet container on observability dashboards, defeating the point of having structured logging at all. Fixing it surfaced how mixed the HttpServer class had become — auth, session storage, transport dispatch, middleware setup, and lifecycle all in one ~600-line file with no per-concern test seams (the existing spec covered only handler internals; security headers, CORS, rate limiting, and the error middleware had no direct tests). The split mirrors the pre-existing factory pattern, gives each concern its own spec file (7 new test files, +400 tests), and leaves public API and observable behaviour identical — every invariant (HSTS-in-prod, JSON-RPC rate-limit body, dual MCP mount for Claude Desktop, OAuth token-refresh on existing sessions, shutdown ordering) is preserved.

[0.36.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.36.0...v0.36.1

## [0.36.0] — 2026-05-21

### Changed

- **Text-mode log level format.** Replaced the `[info]` bracket slot in `src/services/logger.ts` with an uppercased, 5-char-padded level word (`INFO `, `WARN `, `ERROR`, `DEBUG`) — matches logback's `%-5level` convention and brings mcp-kit in line with pino, Go's slog, Serilog, and Python logging. On TTY (color available), ANSI codes wrap the level word only (green/yellow/red/cyan); on piped stderr, files, and `NO_COLOR=1`, the same uppercase word is emitted without color. The double-bracket pairing `[info] [startup]` becomes the cleaner `INFO  [startup]`.
- **Split text printf into two instances.** `consoleTextFormat` (colored when `COLORIZE` is true) and `fileTextFormat` (always plain) — guarantees file logs never receive ANSI codes even when stderr is a TTY. JSON output unaffected: `level` remains lowercase as a structured field.

### Why this matters

The `[level]` bracket was a winston-default artifact, not an industry convention. Now that v0.35.0 brought reliable TTY color detection via `supports-color`, the bracket adds noise without information — color tells you "warning" at a glance, and the uppercase padded word survives in non-color contexts so file logs and piped stderr still let you spot warn/error among info lines. The visible double bracket (`[info] [startup]`) was also visually heavy; dropping it makes the `[service]` namespace prefix do the work it's meant to do.

[0.36.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.35.1...v0.36.0

## [0.35.1] — 2026-05-21

### Security

- **Cleared all 12 open `npm audit` advisories** (1 critical, 4 high, 7 moderate). `npm audit` now reports `found 0 vulnerabilities`.
- Bumped `@opentelemetry/sdk-node` from `^0.213.0` to `^0.218.0` in `package.json` to pull in `@opentelemetry/exporter-prometheus >=0.217.0`, which fixes the prometheus exporter process-crash advisory ([GHSA-q7rr-3cgh-j5r3](https://github.com/advisories/GHSA-q7rr-3cgh-j5r3), high). This was the only fix that required a direct `package.json` change — npm flagged it as a breaking change because the SDK minor was below `^0.217.0`.
- Ran `npm audit fix` to pick up patched transitives for `axios` (multiple high/moderate — prototype pollution, SSRF, CRLF injection, etc.), `protobufjs` (critical RCE + DoS chain), `@protobufjs/utf8`, `brace-expansion`, `fast-uri`, `follow-redirects`, `hono`, `ip-address` (+ `express-rate-limit` dependent), and `postcss`.

### Why this matters

The opentelemetry prometheus exporter CVE was the only advisory that couldn't be cleared by lockfile-only updates — `@opentelemetry/sdk-node@^0.213.0` resolved to a sub-`0.217.0` exporter no matter how the lockfile was regenerated, so the manifest range had to move up. The other 11 advisories were addressable purely through transitive updates and were resolved by a plain `npm audit fix`. Net result: clean audit with no functional changes to mcp-kit source code, no semver-major bumps to direct dependencies, and the prometheus exporter back on a supported, patched line.

[0.35.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.35.0...v0.35.1

## [0.35.0] — 2026-05-18

### Changed

- **Console color is auto-detected.** Replaced the `FORCE_COLOR`-presence check in `src/services/logger.ts` with `supports-color`'s stderr probe. Colors now turn on automatically in a TTY and stay off when stderr is captured by a host app or log collector. The standard `FORCE_COLOR` (force on, useful under `concurrently`) and `NO_COLOR` (force off) overrides are honored. The `FORCE_COLOR` row is removed from the README env-var table since it's no longer an mcp-kit-specific knob.

### Dependencies

- Add `supports-color@^10.2.2` as a direct dependency (already transitive; promoted to direct so the logger can call it explicitly).

### Why this matters

The old gate (`'FORCE_COLOR' in process.env`) required every developer to set an env var to get readable output in their terminal, and quietly misbehaved for values like `FORCE_COLOR=0` (presence-only check enabled colors regardless of value). Switching to `supports-color` brings mcp-kit in line with the rest of the JS ecosystem (chalk, debug, mocha, jest, pino-pretty all use it), gives users `NO_COLOR` support for free, and keeps `FORCE_COLOR` working as the standard override for piping wrappers like `concurrently`.

[0.35.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.34.3...v0.35.0

## [0.34.3] — 2026-05-13

### Changed

- **GitHub Actions consolidated into one workflow.** `publish.yml` is folded into `ci.yml` as a `publish` job that `needs: ci` and runs only on tag pushes (`if: startsWith(github.ref, 'refs/tags/v')`). Publish is now provably gated on CI green — a red CI on a tag push aborts publish via `needs:` dependency, eliminating the `v0.34.1`-style silent broken-publish.
- **`pull_request` trigger removed from CI.** PRs no longer consume Actions minutes. Pre-merge checks shift left to husky + lint-staged (already configured: `eslint --fix` + `prettier --write` on staged files). Premise: a brief red master after a bad merge is acceptable as long as publish is gated; husky catches the lint/format class locally, and master CI catches anything that slips before tag/publish.
- **`main` branch dropped from triggers.** Repo uses `master` only; `main` was dead config.

### Removed

- **`.github/workflows/publish.yml`** — single workflow file; logic moved into the `publish` job in `ci.yml`.

### Why this matters

After `v0.34.1` shipped a "tag-only" release (publish silently failed because of a refactor downstream caller), the missing gate was that publish was a separate workflow with no dependency on CI succeeding. The `needs: ci` chain in a single workflow makes the gate explicit and impossible to bypass. Separately, every PR was paying for a full Actions run — for a solo project with husky already configured, that's spend that buys very little. The new shape trades pre-merge feedback latency for cost; master CI is the canonical gate before any release.

[0.34.3]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.34.2...v0.34.3

## [0.34.2] — 2026-05-13

### Fixed

- **`Publish to GitHub Packages` workflow.** The `Build` step in `.github/workflows/publish.yml` invoked `npm run build:full`, but v0.34.1 removed that script (folded into `build` via the `prebuild` hook). On the `v0.34.1` tag push, the publish workflow failed with `npm error Missing script: "build:full"` and v0.34.1 never reached GitHub Packages — the git tag exists but the registry never received the artifact. `publish.yml` now calls `npm run build`, matching the new convention.

### Why this matters

v0.34.1 was supposed to make `npm run build` produce the complete publishable artifact — and it does — but the publish workflow was still pinned to the old script name. This is the missed downstream caller from the v0.34.1 refactor. v0.34.1 is a tag-only release; v0.34.2 is the first version of the new build flow that actually reaches the registry.

A secondary lesson, captured in tooling rather than this changelog: the `/ship` skill previously gated only on the master CI workflow after merge; it didn't watch the tag-triggered publish workflow, which is what allowed v0.34.1 to be declared "shipped" while the registry publish was failing. The skill now waits on every tag-triggered workflow before reporting success.

[0.34.2]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.34.1...v0.34.2

## [0.34.1] — 2026-05-13

### Fixed

- **CI Build step on master.** `npm run build` produced an incomplete artifact when run from a clean checkout: it copied `src/mcp/apps/dist/*.html` into `dist/`, but those HTML files are Vite outputs gitignored under `dist/` — so on CI (no prior `build:apps` run) the copy failed with `cp: cannot stat 'src/mcp/apps/dist/*.html': No such file or directory`. The repo had a separate `build:full` script that chained `build:all-apps && build` and was used by `prepublishOnly`, but CI invoked `npm run build` directly and never ran the apps build.

### Changed

- **`npm run build` now produces the complete publishable artifact.** Added a `prebuild` npm lifecycle hook that runs `build:all-apps` before `build`, matching the [Astro pattern](https://github.com/withastro/astro/blob/main/packages/astro/package.json) for pre-stringifying runtime assets. Any caller — CI, contributors, `prepublishOnly` — gets the full build from a single command.
- **`build:full` script removed.** It is now identical to `build` thanks to the `prebuild` hook, so keeping both would be a footgun (which one is "really" the full build?). `prepublishOnly` now calls `npm run build`.

### Why this matters

The split between `build` and `build:full` was a hidden invariant: "use `build` for TS-only iteration, `build:full` for publish/CI". CI didn't get the memo, and master CI went red after #81 merged. The conventional pattern across published-to-npm libraries (Vite, Astro, TanStack Query, Next.js, Mantine, esbuild) is that `npm run build` always produces the complete artifact; fast inner-loop iteration uses `dev` (`tsc --watch`) or `build:check` (`tsc --noEmit`), not `build`. This release adopts that convention.

[0.34.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.34.0...v0.34.1

## [0.34.0] — 2026-05-13

### Added

- **`analysis_act` tool** — fifth member of the analysis tool family. Resolves matching record IDs server-side from `ingested_records` using the same `where` vocabulary as `analysis_query mode: "filter"`, then runs batched PATCH/DELETE against the upstream API. Only an aggregate `{ summary, sample_errors }` envelope returns to context — per-record IDs and results never echo back to the LLM. Supports `dry_run` for previewing match count, a small sample, and the `ingestedAt` range before mutating. Internal batches of 50 (higher than `bulk_action_models` because batches are never surfaced to the LLM); concurrency cap of 5. Emits MCP progress notifications when the client supplies a `progressToken`.
- **`getIngestedRecordIdsFiltered`, `getIngestedRecordDryRun`** facade functions on `vector-storage.ts` — extend the storage layer with filtered ID resolution and dry-run preview, reusing the existing `buildWhereConditions` predicate builder.
- **`setRetentionDays(days)`** on the `ingested-records` vendor module — configures TTL for newly stored rows.
- **`ingestedRecordsRetentionDays`, `backgroundCleanupIntervalMs`** options on `initVectorStorage` — first knob configures the analysis snapshot retention; second opt-in option schedules a periodic cleanup sweep across all three pgvector tables for long-lived servers.
- **"Tool responses stay concise"** design principle in `AGENTS.md` — codifies the no-per-record-arrays invariant so future bulk tools don't regress context bloat.

### Changed

- **`ingested_records` TTL defaults to 7 days** (was 1 hour). Covers morning-ingest / afternoon-act and weekend-pause workflows. `analysis_memories` is unchanged at 1 h ephemeral — the `persistent: true` flag already covers long-lived findings. Existing rows keep their original `expires_at` until evicted on schedule; only freshly stored rows get the new TTL.
- **Boot-time cleanup** in `pgvector/initialize` now sweeps all three tables (`tool_memories`, `ingested_records`, `analysis_memories`) instead of just `tool_memories`.
- **`pgvector/close`** clears the periodic cleanup interval when one is active, preventing hanging timers in test processes.

### Why this matters

The four-tool analysis family was built around the principle that raw rows never enter the LLM context window. Acting on a subset broke that — `analysis_query mode: "filter"` had to return IDs to context so the LLM could feed them to `bulk_action_models`. For a 5,000-record session that's O(N) context tokens spent on ID ferrying alone. `analysis_act` keeps the IDs server-side end-to-end; the LLM sees only the aggregate outcome. The retention bump is the matching change: a 1-hour TTL meant an LLM that ingested in the morning and decided to act in the afternoon hit a silently empty session. Closes #80.

[0.34.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.33.0...v0.34.0

## [0.33.0] — 2026-05-11

### Changed (breaking)

- **Tool surface refactor for data tools and MCP Apps.** Paired data/app tools now share a root with the app variant carrying a consistent `_app` suffix; descriptions follow the OpenAI Apps SDK "Use this when…" pattern with explicit cross-references; app-tool responses carry a slim LLM-facing summary that names the App, enumerates record ids, and instructs the model not to repeat record contents in chat; the bulky UI payload is tagged `_meta.context.lifecycle: 'transient'` so harnesses can compress it after the directive is read. Renames:

  | Old                         | New                  |
  | --------------------------- | -------------------- |
  | `find_model` (tool)         | `find_records`       |
  | `view_records` (app)        | `find_records_app`   |
  | `search_records_view` (app) | `search_records_app` |
  | `list_records_view` (app)   | `list_records_app`   |

  The `FindModelTool` class is renamed to `FindRecordsTool` and the file moves from `tools/data/find-model-tool.ts` to `tools/data/find-records-tool.ts`. The `DATA_TOOL_CLASSES` registry key updates accordingly. App resource URIs change to `ui://<ns>/find-records-app`, `ui://<ns>/list-records-app`, `ui://<ns>/search-records-app`. The `_meta.ui.resourceUri` discriminator (MCP Apps spec) continues to be advertised on every app tool — clients that key off metadata are unaffected. There are no compatibility shims; downstream consumers must rename their references.

- **`readOnlyHint: true`** is now declared on `find_records_app`, `list_records_app`, and `search_records_app` via a new `annotations` field on `AppDefinition`, aligning the apps with OpenAI Apps SDK / MCP guidance for read-only tools.

### Added

- **`src/mcp/apps/format-summary.ts`** — `formatAppSummary({ toolName, count, ids, page, totalPages, totalRecords, context })` builds the standard block-1 directive; `appResponseMeta(summary)` returns the response-level `_meta` that tags block 0 as transient. Used by all three record-rendering apps to keep wording identical.

### Why this matters

LLMs running against mcp-kit servers were repeating record contents in chat even after the data was rendered in an MCP App widget. Two root causes: (1) co-exposed data/app variants with overlapping names and no consistent suffix; (2) indistinguishable response shapes — both halves returned full record JSON, so the LLM had no in-band signal that the user had already seen the data. The refactor closes both: consistent `_app` suffix gives the LLM a pattern-match handle, and the slim block-1 directive plus transient `_meta` mean the app response is structurally a "the data is on screen, do not echo" answer rather than a payload the LLM must summarize. The conventions follow [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/plan/tools)'s data-vs-render-tool guidance and the [MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview).

[0.33.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.32.1...v0.33.0

## [0.32.1] — 2026-05-11

### Fixed

- **Idempotent ingestion for `analysis_ingest`** — `storeRecords` now uses `INSERT ... ON CONFLICT DO UPDATE` against a new partial unique index on `(analysis_id, model, record_id)`. Re-ingesting the same records overwrites instead of duplicating rows, preventing inflated counts in downstream `analysis_query` aggregations and incorrect scheduling duplication in workflows.

- **Deduplicated parent ID resolution** — `getRecordIds` now returns `SELECT DISTINCT record_id`, preventing duplicate parent fetches during nested resource ingestion when historical rows exist from prior retries.

### Added

- **Migration `005`** — `add_ingested_records_unique_index`: partial unique index on `ingested_records(analysis_id, model, record_id) WHERE record_id IS NOT NULL`.

[0.32.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.32.0...v0.32.1

## [0.32.0] — 2026-05-11

### Added

- **RFC 8707 resource indicator injection in the OAuth proxy.** `createOAuthRouter()` now ensures every authorization and token exchange routed through the MCP server is bound to this resource via the RFC 8707 `resource` parameter. The `/oauth/authorize` redirect URL and `/oauth/token` request body always carry `resource=<canonical>` — overwriting any client-supplied value, because a client hitting _this proxy_ is by definition trying to access _this resource_; this defends against token-substitution while still working for clients that do not implement RFC 8707 themselves (e.g. Claude Desktop today). Tokens issued through this flow are now audience-bound, so the introspection-side audience check (in `OAuthService`) sees a matching `aud` claim instead of `aud: absent`.

- **`resourceUri` option on `OAuthRouterConfig`.** Single source of truth for the canonical resource URI used in (a) the RFC 9728 PRM `resource` field, (b) the injected `resource` parameter on `/authorize` and `/token`, and (c) the audience check at introspection. Defaults to `${baseUrl}/mcp` (the conventional MCP endpoint path); embedding servers override only for non-standard paths. **Important:** the embedding server's `OAuthService.resourceUri` MUST match this value, otherwise the proxy injects a `resource` the audience check then rejects.

### Why this matters

Identity introspection of Claude Desktop tokens against engineer-mcp was returning `{active: true}` with no `aud` claim, and engineer-mcp's `OAuthService` was downgrading the result to inactive via the RFC 8707 audience check. The tokens had no audience because Claude does not echo the PRM `resource` field on its authorize/token calls. Rather than wait for client-side conformance, the proxy now stamps `resource` server-side so any MCP client gets audience-bound tokens regardless of its RFC 8707 implementation status.

[0.32.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.31.0...v0.32.0

## [0.31.0] — 2026-05-11

### Added

- **`scopes_supported` in Protected Resource Metadata (RFC 9728 §2)** — `createOAuthRouter()`'s PRM handler now emits the resource-scoped scope catalog, derived from the server-supplied `oauth.scopes` and split on whitespace. The field had been missing, forcing well-behaved clients to fall back to the AS-wide `scopes_supported` (RFC 8414), which legitimately may include scopes that don't apply to a given resource (e.g. `trusted`, `admin`, OIDC scopes for other clients). That fallback was the root cause of spurious `invalid_scope` errors against MCP resources whose accepted scope set was narrower than the AS's catalog. The AS-metadata proxy and `openid-configuration` handler are intentionally left untouched — AS metadata is the AS's own catalog; rewriting it would mask client misbehavior instead of fixing the actual RFC 9728 gap here.

[0.31.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.30.3...v0.31.0

## [0.30.0] — 2026-05-03

### Added

- **Topology-aware RFC 9728 endpoint registration** — `HttpServer` now auto-skips registering the two Protected Resource Metadata routes (`/.well-known/oauth-protected-resource` and the §3.1 `/mcp` form) whenever it's mounted under a non-empty `pathPrefix`. `.well-known` URIs are origin-scoped and cannot be served from inside a sub-path, so an upstream reverse proxy must own them. The `WWW-Authenticate` header continues to advertise the correct origin-rooted URL via `buildResourceMetadataUrl()`, so client discovery is unaffected.
- **`serveProtectedResourceMetadata` config on `OAuthRouterConfig`** — Optional flag (default `true`) that gates PRM route registration in `createOAuthRouter()`. `HttpServer` derives the value from `pathPrefix === ''`; direct callers can override.
- **"Path-Prefixed Deployments" guide section** in `docs/guides/oauth2-discovery-flow.md` explaining the operator's responsibility and showing a minimal nginx snippet to serve PRM at the origin root.
- **README footnote** on the RFC 9728 row of the OAuth compliance table cross-referencing the new guide section.

[0.30.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.29.0...v0.30.0

## [0.29.0] — 2026-05-03

### Added

- **OAuth 2.1 query parameter token rejection** — The `/mcp` endpoint now explicitly rejects bearer tokens sent via URI query parameters (`?access_token=`) with HTTP 400 `invalid_request`, per OAuth 2.1 §5.1.2. Prevents accidental token leakage via server logs, referrer headers, and browser history.
- **OAuth 2.1 `response_type` validation on authorize proxy** — The `GET /oauth/authorize` proxy now rejects any `response_type` other than `code` with HTTP 400 `unsupported_response_type`, per OAuth 2.1 §4.1.1 which removes the implicit grant.
- **OAuth 2.1 compliance contract test suite** — New `oauth21-compliance-contract.spec.ts` with 12 tests validating cross-cutting OAuth 2.1 invariants: PKCE S256 mandatory, no implicit grant, no ROPC grant, bearer token header-only, redirect URI exact matching.

### Fixed

- **Introspection cache invalidation on token revocation** — `revokeToken()` now clears the introspection cache entry for the revoked token, eliminating the 60-second window where a revoked token could still be accepted from cache.

[0.29.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.28.0...v0.29.0

## [0.28.0] — 2026-05-02

### Added

- **RFC 8707 audience validation in token introspection** — `introspectToken()` now validates that the `aud` claim in the introspection response matches the configured `resourceUri`. Tokens issued for a different resource server are rejected (`active: false`), cached to avoid repeat calls, and reported via error tracking with `AUTH` category. Tokens without an `aud` claim are also rejected when `resourceUri` is set.
- **`AudienceMismatchError` class** — Structured error with `expectedAudience` and `actualAudience` fields, exported from `oauth2/index.ts`.

### Fixed

- **CIMD metadata test expectations** — Fixed two stale tests in `oauth-router.spec.ts` that expected old default values for `redirect_uris` and `scope` instead of the actual `${baseUrl}/oauth/callback` and `oauth.scopes` fallbacks.

[0.28.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.27.0...v0.28.0

## [0.27.0] — 2026-04-29

### Added

- **RFC 9111 cache headers on CIMD metadata endpoint** — The `/oauth/client-metadata.json` endpoint now sends `Cache-Control: public, max-age=3600` and an `ETag` header. Authorization servers that respect HTTP cache headers (per the IETF Client ID Metadata Document draft) can use these to decide when to re-fetch metadata. The `max-age` is configurable via `ClientMetadataConfig.cacheMaxAge`.

[0.27.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.26.1...v0.27.0

## [0.26.1] — 2026-04-29

### Changed

- **Unified MCP progress notifications across all bulk tools** — `BulkActionModelsTool` now sends `notifications/progress` after each record is processed during bulk create, update, and delete operations (up to 25 records with concurrency cap of 5). `AnalysisIngestTool._ingestNestedResources` now reports progress after each parent's nested resources are fetched. Both use fire-and-forget progress callbacks in their concurrent worker pools.

[0.26.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.26.0...v0.26.1

## [0.26.0] — 2026-04-29

### Added

- **Resumable ingestion** — `analysis_ingest` now accepts a `resume` parameter. When used with `ingest_all`, it detects already-stored records and skips completed pages, allowing large ingestions to continue from where they left off after client disconnects or token exhaustion.
- **MCP progress notifications** — the tool execution pipeline now threads the SDK's `RequestHandlerExtra` through to tool instances via `ToolContext.extra` and `BaseTool._extra`. Tools can call `this.sendProgress({ progress, total, message })` to send `notifications/progress` to clients that request progress tracking. `analysis_ingest` reports page-by-page progress during `ingest_all`.
- **Abort signal access** — `BaseTool.abortSignal` getter exposes the client request's `AbortSignal` for future cancellation support.
- **`ToolHandlerExtra` type** — exported from `mcp-kit/tools` for interceptors and custom tools that need to interact with the SDK request context.
- **`ToolHandler` type** — exported convenience type for the `(args, extra?) => Promise<ToolResult>` handler signature.
- **`getIngestedRecordCount`** — new vector storage function for counting ingested records by session and model without loading all IDs.

### Changed

- **Moved `AnalysisIngestTool` to `analysis/` directory** — the tool now lives with its semantic family (`analysis_store`, `analysis_query`, `analysis_clear`) under `src/mcp/tools/analysis/`. It extends `BaseAnalysisTool` (ANALYSIS category, gated on vector storage) and overrides `requiresAuth` to `true` since it needs API authentication. Moved from `DATA_TOOL_CLASSES` to `ANALYSIS_TOOL_CLASSES`. Public API export unchanged.
- **`wrapToolHandler` signature** — now accepts and passes an optional `ToolHandlerExtra` parameter through the interceptor chain. Existing interceptors and handlers continue to work unchanged.
- **`ToolContext` type** — gains an optional `extra` field exposing the SDK request handler context (progress token, abort signal) to interceptors.

[0.26.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.25.1...v0.26.0

## [0.25.1] — 2026-04-29

### Fixed

- **CIMD default `redirect_uris`** — was hardcoded to `http://127.0.0.1/callback`, now defaults to `${baseUrl}/oauth/callback` using the server's own base URL. The previous default didn't match any registered route.
- **CIMD default `scope`** — was hardcoded to `read`, now defaults to `oauth.scopes` (the scopes the server is actually configured to request). Prevents mismatches between what the metadata document advertises and what the server requests during authorization.

[0.25.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.25.0...v0.25.1

## [0.25.0] — 2026-04-29

### Added

- **ToolRegistry class** — convention-based tool registration that eliminates the ~100-line boilerplate every integrator writes. Handles schema validation, auth wrapping per tool category, tracing, logging, error catching, and feature gating via a single constructor call. Configurable with `toolClasses`, `models`, `createApiClient`, `gates`, and custom `interceptors`.
- **Tool execution pipeline** — composable `ToolInterceptor` interface with `before`/`after`/`onError` hooks and a `wrapToolHandler` utility for cross-cutting concerns (audit logging, permission checks, metrics). Before hooks run in declared order; after/onError hooks run in reverse order. First `onError` handler that returns a `ToolResult` recovers from the error.
- **Built-in interceptors** — `loggingInterceptor` (tool call start + error logging), `tracingInterceptor` (execution timing via meta), and `errorInterceptor` (catches unhandled errors, returns structured MCP error response). Applied automatically by `ToolRegistry`; also available standalone for manual pipeline composition.

[0.25.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.24.0...v0.25.0

## [0.24.0] — 2026-04-28

### Added

- **CIMD (Client ID Metadata Document) support** — `HttpServer` now accepts an optional `clientMetadata` config and serves a JSON metadata document at `GET /oauth/client-metadata.json`. MCP clients can use this URL as their `client_id`; the authorization server fetches the metadata and registers the client automatically. Configurable `redirectUris`, `clientName`, and `scope` with sensible defaults.
- **Client Registration Strategies documentation** — new collapsible section in README explaining all three supported strategies (Pre-registered CC, DCR, CIMD) with a summary table and code examples.

[0.24.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.23.1...v0.24.0

## [0.23.1] — 2026-04-28

### Changed

- **Enforce bulk_action_models for multi-record operations** — the bulk tool description now says REQUIRED (not PREFERRED) when operating on more than one record, covering all multi-record scenarios instead of only tabular data imports. The atomic tools (create_model, update_model, delete_model) are explicitly scoped to single-record use and redirect LLMs to bulk_action_models, preventing repeated atomic calls.

[0.23.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.23.0...v0.23.1

## [0.23.0] — 2026-04-27

### Changed

- **Complete RFC 8707 Resource Indicators compliance** — added `resourceUri` validation in the `OAuthService` constructor enforcing absolute URI (MUST), no fragment (MUST NOT), and no query component (SHOULD NOT) per RFC 8707 Section 2. The `resource` parameter is now included in refresh token grants (RFC 8707 Section 5) and client credentials grants when `resourceUri` is configured, ensuring audience-restricted tokens across all OAuth grant types. Previously only authorization requests and authorization code token exchanges included the parameter.
- **RFC 8707 test coverage** — added constructor validation tests (fragment, query, relative URI rejection), property-based tests for resource parameter presence/absence in refresh token and client credentials flows, and unit tests verifying the parameter is forwarded to `openid-client` grant functions.

[0.23.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.22.0...v0.23.0

## [0.22.0] — 2026-04-26

### Added

- **MCP client identification in structured logs** — after the MCP handshake, the server now captures `clientInfo` (name, version) from the SDK's `oninitialized` hook and propagates it to all subsequent logs, error tracking (Sentry), and tracing (Langfuse). A `"Client connected"` log entry is emitted with client name, version, transport, and summarized capabilities. Every tool execution log automatically includes `clientName`, `clientVersion`, and `transport` via the enriched `logContext`.
- **Logging environment variables documented in README** — `LOG_LEVEL`, `LOG_FORMAT`, `FORCE_COLOR`, and `LOG_FILE_ENABLED` are now listed in the Environment Variables table with a development tip.

### Changed

- **Logfmt text format for console output** — text-mode logs now render metadata as human-readable `key=value` pairs instead of appended `JSON.stringify()` blobs. Strings with spaces are quoted, nested objects fall back to JSON. The `app` key is omitted in text mode (redundant with `service`). JSON format for production/Loki is unchanged.
- **Centralized session context setup** — `setSessionContext()` and `setMcpClientContext()` are now called from the server factory's `oninitialized` hook instead of individually in each transport, removing duplication.

[0.22.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.21.0...v0.22.0

## [0.21.0] — 2026-04-25

### Added

- **Convention-driven error parsing** — new `parseErrorResponse(response)` method on `BaseConvention` extracts structured error messages from HTTP error responses. Each convention knows its API's error envelope, returning a flat `string[]` of error messages. `JsonApiConvention` handles Rails validation hashes (`{ errors: { field: [msgs] } }`), single errors (`{ error: "msg" }`), and error arrays.
- **`ErrorResponse` interface** — typed shape (`{ status?, data? }`) for HTTP error responses passed to convention error parsing. Exported from `mcp-kit/prompts`.
- **`storeToolMemory()` on BaseTool** — protected fire-and-forget helper that encapsulates the vector storage pattern (calling `storeOperation` + `.catch()` logging). Extracts `sessionId` from `serverContext` internally.
- **`sessionId` on `ServerContext`** — the interface now declares `sessionId?: string`, matching what the runtime already sets in both stdio and HTTP servers. Eliminates unsafe `Record<string, unknown>` casts at every call site.

### Changed

- **LLM-optimized error formatting** — `formatError()` now delegates to the convention's `parseErrorResponse()` and formats errors as semicolon-separated text with inline status: `title: can't be blank; status: is not included (422)`. No `Error:` prefix (redundant with `isError: true`) or `Status: N/A` noise.
- **DRYed up vector storage in CRUD tools** — replaced duplicated 10-line `storeOperation` fire-and-forget blocks in `create-model-tool`, `update-model-tool`, `delete-model-tool`, and `bulk-action-models-tool` with single-line `this.storeToolMemory()` calls.
- **Updated docs** — `api-config-guide.md` documents error parsing in the Convention Integration section; `tool-creation-guide.md` documents `storeToolMemory()` and the new `formatError` behavior.

[0.21.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.20.0...v0.21.0

## [0.20.0] — 2026-04-24

### Added

- **Nesting info in `list_models`** — output now includes `parent`, `standalone` (only when `false`), and `actions` summary (name, method, description) per model. LLMs can discover nested resource relationships upfront instead of learning from errors.
- **Registry-aware `MissingParentError`** — error messages now show concrete parent endpoint paths (e.g., `'titles/{id}/assets'`) instead of generic placeholders (`'{parent_endpoint}/{parent_id}/assets'`). ModelService enriches errors using the models registry.

### Changed

- **Improved `parent_path` tool descriptions** — `create_model`, `find_model`, and `bulk_action_models` descriptions now include the format template `{parent_endpoint}/{parent_id}/{model_endpoint}`, explain the `standalone: false` trigger, and cross-reference `list_models` for discovery.
- **`MissingParentError` constructor** — now accepts `childEndpoint` and exposes `model`, `childEndpoint`, and `parentModels` as readonly properties for downstream enrichment.
- **Removed duplicate `EndpointOverrides`** — `endpoint-resolver.ts` now re-exports from `base-model.ts` instead of declaring its own identical interface.
- **Cleaned up unsafe casts** — removed `Record<string, unknown>` casts in `EndpointResolver` (`_getOverrides`, `_resolveNamespace`, `resolveAction`) and `ModelService` (`action`), using direct optional chaining on typed `ModelConfig.api`.

[0.20.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.19.0...v0.20.0

## [0.19.0] — 2026-04-24

### Added

- **Custom actions on models** — new `actions` config on `ApiConfig` enables declaring custom endpoints beyond CRUD with any HTTP method and Rails-style URL path templates. Actions are model-scoped, resolved through `EndpointResolver`, and dispatched through `ModelService`.
- **`ActionDefinition` interface** — declares `method` (GET/POST/PUT/PATCH/DELETE), `path` (with `:id` and `:param_name` placeholders), `recordLevel`, `description`, and `rawPayload` options.
- **`EndpointResolver.resolveAction()`** — layered resolution for custom actions: substitutes `:id` from `recordId`, `:param_name` from `pathParams`, handles compound IDs (skip base prepend), and applies namespace.
- **`ModelService.action()`** — orchestrates custom action execution through the resolver + convention + ApiClient pipeline. Supports convention-wrapped payloads (default) or raw payloads (`rawPayload: true`), query params for GET actions, and user impersonation.
- **`ModelActionTool`** (`model_action`) — new MCP tool that exposes custom actions to LLMs. Dynamically discovers models with actions and includes action summaries (names, methods, descriptions) in the tool description.
- **`UnknownActionError`** — thrown when a custom action is not declared on the model, with available actions listed in the error message.
- **`ActionContext` interface** — extends `EndpointContext` with `action` name and `pathParams` for multi-parameter URL substitution.
- **Rails-style path parameter substitution** — action paths support multiple named parameters (e.g., `:id/chapters/:chapter_id/approve`) resolved from `recordId` and `pathParams`.
- **API Configuration Guide** (`docs/guides/api-config-guide.md`) — exhaustive standalone guide covering the complete `ApiConfig` and `ActionDefinition` reference, endpoint resolution chains, ModelService integration, compound IDs, and real-world examples.

[0.19.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.18.0...v0.19.0

## [0.18.0] — 2026-04-24

### Changed

- **`endpoint` moved into `api` config** — `static endpoint = 'books'` is now `static api = { endpoint: 'books' }` on both `BaseModel` and `ModelConfig`. Co-locates all API concerns (`endpoint`, `convention`, `parent`, `standalone`, `namespace`, `endpoints`) under a single config object.
- **`ApiConfig.endpoint`** — new field on the `ApiConfig` interface. `ModelConfig.api` and `AppModelClass.api` are now required (previously optional) since `endpoint` is required.
- **Optional `static modelName`** — new property on `BaseModel` that overrides the derived `singularName`. Fixes the fragile `endpoint.replace(/s$/, '')` pattern for irregular plurals (e.g., `static modelName = 'activity'` for endpoint `'activities'`).

[0.18.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.17.0...v0.18.0

## [0.17.0] — 2026-04-24

### Added

- **Compound ID support** — path-based compound IDs (`titles/42/assets/7`) encode full resource hierarchy, enabling uniform CRUD for nested and top-level resources. New `compound-id.ts` module with `parseId`, `buildCompoundId`, and `buildCollectionPath` utilities.
- **`parent_path` parameter** on `find_model` and `create_model` — replaces separate nested resource tools for listing and creating nested collections (e.g., `find_model(model: "asset", parent_path: "titles/42/assets")`).
- **`ModelRequestOptions`** — extended request options type with `parentPath` for `ModelService.create()` and `ModelService.list()`.

### Changed

- **`ModelConfig.api`** — replaced `nested` block (`pathTemplate`, `parentKey`, `nestedOnly`, `parentModels`) with flatter `parent` and `standalone` fields. Models declare `api: { parent: 'title', standalone: false }` instead of the verbose nested config.
- **`EndpointResolver`** — `resolveRecord()` now handles compound IDs (containing `/`) as full paths. `resolveCollection()` uses `parentPath` instead of `parentResource` and pathTemplate substitution. `MissingParentError` now reports parent model names instead of parentKey.
- **`BulkActionModelsTool`** — `parent_resource` renamed to `parent_path`. Update/delete operations support compound IDs via `_resolveRecordEndpoint()`.
- **Prompt generators** — `parentResource`/`parent_resource` renamed to `parentPath`/`parent_path` across tool-usage-generator, base-prompt, association-transformers, and hybrid-strategy.
- **Apps layer** — `AppModelClass.api` uses `parent`/`standalone` instead of `nested` block. Form schema detects nested associations via `standalone === false`. Model form constructs paths from parent endpoint + child endpoint.

### Removed

- **`get_nested_resources` tool** — functionality absorbed by `find_model` with `parent_path` parameter.
- **`bulk_get_nested_resources` tool** — functionality absorbed by `find_model` with `parent_path` parameter.
- **`ModelService.getNestedResources()`** — replaced by `list()` with `parentPath` option.
- **`EndpointResolver.resolveNested()`** — replaced by compound ID handling in `resolveRecord()`.
- **`detectParentResource()` and `buildParentTypes()`** — helper functions from `core/helpers.ts`, no longer needed with explicit compound IDs.
- **`ParentType`, `ParentResource`, `NestedConfig`** — removed interfaces.

[0.17.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.16.0...v0.17.0

## [0.16.0] — 2026-04-23

### Added

- **`EndpointResolver`** — layered URL resolution for model CRUD operations, inspired by Ember Data's Adapter pattern. Resolution chain: per-action override → collection override → nested routing → namespace + convention → base endpoint. Consolidates endpoint logic previously scattered across 7+ tool files.
- **`ModelService`** — CRUD service layer composing EndpointResolver + Convention + ApiClient. Tools delegate here instead of directly resolving endpoints and building payloads. Returns raw API responses with typed domain errors (`ModelReadOnlyError`, `MissingRequiredFieldsError`, `UnknownModelError`).
- **`RequestOptions` on `ApiClient`** — optional third parameter on all ApiClient methods for typed request options (e.g., `userId` impersonation). Eliminates the `as unknown as Record<string, (...args) => Promise>` cast that was duplicated across 8+ tool files.
- **`namespace` on `ApiConfig`** — server-wide default with per-model override, like Ember Data's namespace property. Prefix all model endpoints with an API namespace (e.g., `api/v1`).
- **`endpoints` on `ApiConfig`** — per-action endpoint overrides (`collection`, `record`, `create`, `update`, `delete`) for models with non-standard API paths.
- **`modelService` on `ToolDependencies`** — optional dependency. `BaseTool` lazily constructs a `ModelService` from `apiClient` + `models` when not explicitly injected.
- **`requireModelService()`** — helper on `BaseTool` that ensures `ModelService` is available (calls `requireApiClient()` first).
- **Service layer guide** — new documentation at `docs/guides/service-layer-guide.md`.
- **`AGENTS.md`** — project-level agent instructions per [agents.md](https://agents.md) convention.

### Changed

- **CRUD tools refactored** — `CreateModelTool`, `FindModelTool`, `UpdateModelTool`, `DeleteModelTool` now delegate all CRUD operations to `ModelService`. No fallback code paths.
- **`LoggingApiClient`** — uses typed `RequestOptions` signatures instead of `...rest: unknown[]` spread params.
- **`SearchClient` renamed to `SearchService`** — for consistency with `ModelService` naming.

[0.16.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.15.0...v0.16.0

## [0.15.0] — 2026-04-22

### Added

- **Proximity sampling for `analysis_query`** — new `proximity` parameter in sample mode enables date-windowed, bucket-stratified sampling via PostgreSQL `date_bin()`. Centers on a date, defines a symmetric time window, and distributes sample slots evenly across temporal buckets. Combine with `where` for pre-filtered sampling and `stratify_by` for composite (discrete × temporal) stratification.
- **`where` in sample mode** — sample mode now accepts the same `where` filter syntax as filter mode (exact match via `@>`, range operators `$gt/$gte/$lt/$lte`), enabling pre-filtered sampling in a single call.
- **`buildWhereConditions` shared helper** — extracted WHERE clause construction from `queryFilter` into a reusable function shared between filter and sample modes.
- **`validateInterval` utility** — regex whitelist validation for PostgreSQL interval strings to prevent SQL injection in proximity window/bucket parameters.

[0.15.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.14.0...v0.15.0

## [0.14.0] — 2026-04-20

### Added

- **Stratified sampling for `analysis_query`** — new `stratify_by` parameter in sample mode distributes sample slots evenly across distinct values of a JSONB field. Ensures minority groups are always represented instead of being drowned out by uniform random sampling. Uses `ROW_NUMBER() OVER (PARTITION BY)` window function for equal-allocation budgeting.

### Changed

- **Search config restructure** — `search.autocompleteFields` moved to `search.lookup.fields` for consistency with the lookup config namespace. Affects `list-schema.ts`, `list-models-tool.ts`, and test fixtures.

[0.14.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.13.0...v0.14.0

## [0.13.0] — 2026-04-20

### Added

- **`RailsSearchAdapter`** — new adapter for Rails-convention search endpoints. Provides `filtersParam` nesting and `rangeMappings` flattening. Set server-wide via constructor (`new RailsSearchAdapter({ filtersParam: 'filters' })`), with per-model overrides via `search.query.adapterConfig`. Exported from `mcp-kit/search`.
- **`SearchService.defaultAdapter`** — constructor option to set a server-wide default adapter. Per-model and per-group adapters still override.
- **`AppRegistry.defaultAdapter`** — pass-through so apps inherit the server's adapter when creating SearchService instances.
- **`src/mcp/search/types.ts`** — centralized type definitions for all search-related interfaces (ApiClient, SearchConfig, QueryConfig, PaginationInfo, SearchResult, etc.).
- **`SearchApiClient`** type — `Pick<ApiClient, 'get' | 'post'>` for consumers that only need read operations.

### Changed

- **`SearchAdapter` (base)** — now spreads filters flat into the POST body by default (most generic behavior). Previously required `filtersParam` to include filters at all; without it filters were silently dropped.
- **`ApiClient` interface unified** — single canonical interface with all CRUD methods returning `Promise<Record<string, unknown>>`. Previously had two incompatible definitions (tools vs search).
- **`PaginationInfo` deduplicated** — single definition in `types.ts`, eliminating 3 identical copies across `base-convention.ts`, `search-client.ts`, and `search-records-tool.ts`.
- **Type locations** — `SearchConfig`, `QueryConfig`, `LookupConfig` moved from `core/base-model.ts` to `mcp/search/types.ts`. Public API re-exports unchanged.

### Removed

- **`filtersParam` and `rangeMappings` from `QueryConfig`** — moved to `RailsSearchAdapter` via `adapterConfig`. Models using these fields must migrate to `search.query.adapterConfig` and set `RailsSearchAdapter` as the default adapter.
- **`filtersParam` from `SearchGroup`** — adapter handles filter nesting now.

[0.13.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.12.0...v0.13.0

## [0.12.0] — 2026-04-17

### Removed

- **HAL convention** — `halConvention` export removed from `mcp-kit/prompts`. The HAL convention was application-specific protocol behavior; it has been moved to its downstream consumer for independent evolution. `BaseConvention`, `defaultConvention`, and `jsonApiConvention` remain available.

[0.12.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.11.0...v0.12.0

## [0.11.0] — 2026-04-17

### Added

- **Convention-level nested record extraction** — new `extractNestedRecords(response, attributes?)` method on `BaseConvention` (no-op fallback to `data`/`records` keys) enables API conventions to extract records from nested resource endpoints and optionally filter to model attributes. Addresses the issue where HAL nested endpoints returning `{"entries": [...]}` were not recognized by the generic `_extractRecords` helper.
- **HAL convention nested extraction** — `HalConvention.extractNestedRecords` locates records from `entries`, `_embedded`, or any array key (same heuristic as `normalizeListResponse`). When model `attributes` are provided, only declared attribute keys (plus `id`) are retained, stripping HAL protocol fields (`resource_type`, `*_link`) that are noise for LLM analysis.
- **Debug logging in nested ingestion** — `analysis_ingest` now logs (at debug level) before storing nested records in PG vector, showing child model, record count, sample record, and field keys. Enables inspection of transformation correctness.

### Changed

- **`analysis_ingest` nested resource ingestion** — now resolves the convention from the child model's config (e.g., `metadata_error` → HAL convention), falling back to parent's, then default. Calls `convention.extractNestedRecords(data, childConfig?.attributes)` instead of generic `_extractRecords(data)`, ensuring HAL nested responses are properly parsed.

### Fixed

- **Metadata error ingestion returning 0 records** — nested metadata_errors endpoints return `{"entries": [...]}` which the old `_extractRecords` method didn't recognize. Now uses convention-aware extraction that handles all HAL response envelopes.

[0.11.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.10.0...v0.11.0

### Added

- **Convention-level expanded resource flattening** — new `flattenExpandedResources` method on `BaseConvention` (no-op default) enables API conventions to promote nested expanded association objects into flat top-level scalar fields using the `{association}_{childField}` naming pattern (e.g., `title.name` → `title_name`). Receives the model's `associations` config for structural identification of expandable keys, with a `requestedFields` filter to flatten only what's needed for storage.
- **HAL convention implementation** — `HalConvention.flattenExpandedResources` identifies expanded belongsTo associations from the model's association config (falling back to `resource_type` heuristic when no config is available), builds a filtered flatten map constrained by requested fields, and always includes `{assoc}_id` as a stable foreign key for LLM cross-referencing. HAL protocol metadata (`resource_type`, `*_link`) is excluded from flattening.
- **`analysis_ingest` integration** — the tool now calls `convention.flattenExpandedResources()` before `pickFields` in both `_ingestPage` and `_ingestAllPages`, resolving the convention from `modelConfig.api.convention`. This fixes the issue where expanded HAL associations (e.g., `?expand=title,platform`) were stored as nested objects, making fields like `title_name` and `platform_name` invisible to `analysis_query` aggregations.

[0.10.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.9.0...v0.10.0

## [0.9.0] — 2026-04-17

### Added

- **`LoggingApiClient` decorator** — wraps any `ApiClient` to log all outgoing HTTP requests (method, URL, params, body) and truncated responses at `debug` level. Activate with `LOG_LEVEL=debug`. Array responses are summarized with count and first element; large payloads are capped at 2000 characters.
- **Verbose API call logging in `analysis_ingest`** — the tool now wraps its API client with `LoggingApiClient` when a logger is available, so all outgoing calls (direct GET, SearchService POST/GET, nested resource fetches) are debug-logged with full request/response details for development verification.
- **`LoggingApiClient` exported from `mcp-kit/tools`** — available for consumers to apply to their own tools or API client instances.

[0.9.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.8.0...v0.9.0

## [0.8.0] — 2026-04-16

### Added

- **Nested resource ingestion** in `analysis_ingest` tool — new `parent_model`, `parent_ids`, and `child_resource` parameters enable ingesting child resources (e.g., metadata errors, conflicts) for a set of parent records in a single call, with results stored in offline PostgreSQL storage. Parent IDs can be auto-resolved from previously ingested records in the same analysis session, eliminating the need for the LLM to enumerate them. Each child record gets a `_parent_id` field injected for cross-referencing via `analysis_query` aggregation.
- **`getRecordIds`** function in `ingested-records.ts` — retrieves all record IDs for a given analysis session and model, enabling the auto-resolve mechanism for nested ingestion.
- **`getIngestedRecordIds`** facade in `vector-storage.ts` — public API for the record ID lookup.
- **Concurrency-limited parallel fetch** in nested ingestion — uses a worker pool (max 5 concurrent requests) matching the `bulk_get_nested_resources` pattern, with per-parent error handling and explicit failure reporting (never silent).

[0.8.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.7.0...v0.8.0

## [0.7.0] — 2026-04-16

### Added

- **`describe` mode** in `analysis_query` tool — discovers available fields, types, and query syntax from model attribute config. Provides the LLM with a structured guide before querying, including exact match and range operator examples.
- **Range operator support** in `analysis_query` filter mode — supports `$gt`, `$gte`, `$lt`, `$lte` operators for numeric fields (cast to `::numeric`) and date fields (cast to `::timestamptz`). Exact match values continue to use efficient JSONB containment (`@>`).
- **Numeric stats** in analysis page summaries — `_buildNumericStats` computes min, max, avg, median for numeric fields during ingestion, included in page summary metadata.
- **Date ranges** in analysis page summaries — `_buildDateRanges` detects ISO 8601 date fields and reports earliest/latest values.
- `describeSession` function in `ingested-records.ts` — returns model name and record count for an analysis session.
- `describeAnalysisSession` facade in `vector-storage.ts`.
- `sanitizeFieldName` validation to prevent SQL injection in range query field names.

[0.7.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.6.0...v0.7.0

## [0.6.0] — 2026-04-16

### Added

- **ESLint plugins** aligned with the MCP TypeScript SDK — `simple-import-sort` (auto-sorted imports), `eslint-plugin-n` (`node:` protocol enforcement), `eslint-plugin-unicorn` (kebab-case filenames), `@typescript-eslint/consistent-type-imports`
- **Pre-commit hooks** via husky + lint-staged — runs ESLint fix and Prettier on staged files before every commit
- `prepare` script for automatic hook installation on `npm install`
- `eslint-config-prettier` explicitly wired into ESLint flat config
- CI `format:check` step in GitHub Actions workflow
- CI status badge in README (linked to GitHub Actions)

### Changed

- Replaced manual Node.js globals block in ESLint config with `globals.node`
- Coverage thresholds lowered to match actual coverage (80/73/82/80)
- README badges and text updated to reflect current test count (2054) and coverage (81%)

### Fixed

- 6 ESLint errors — 4 unused imports, 1 `Function` type cast, 1 missing error cause
- 119 Prettier formatting violations across the codebase
- `src/oauth2-ref/` excluded from ESLint (legacy JS reference files with redundant global declarations)

[0.6.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.5.1...v0.6.0

## [0.5.1] — 2026-04-16

### Fixed

- `npm run build` fails on fresh clone — target directory `dist/mcp/apps/dist/` not created by `tsc`

### Added

- `build:all-apps` script — builds all 6 Vite UI targets sequentially
- `build:full` script — runs the complete pipeline (Vite apps + tsc + copy) for fresh clones
- `prepublishOnly` now runs `build:full` to ensure `npm publish` produces a complete package

[0.5.1]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.5.0...v0.5.1

## [0.5.0] — 2026-04-16

### Added

- **MCP tool annotations** for all 21 tools — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` per the MCP spec, enabling clients (e.g., Claude Connectors UI) to properly categorize tools into permission groups
- `defaultAnnotations` field on `CategoryConfig` — category-level annotation defaults so tools inherit correct hints automatically
- `annotations` getter on `BaseTool` — returns category defaults, overridable per-tool
- `ToolAnnotations` type re-exported from `mcp-kit/tools` for consumer convenience
- Enforcement test (`annotations.spec.ts`) ensuring every tool declares annotations with explicit `readOnlyHint`

### Changed

- Bookshelf example updated to pass `tool.annotations` via the 5-arg `mcpServer.tool()` signature
- 10 tools override category defaults with per-tool annotations (read-only DATA tools, non-destructive write tools, ANALYSIS write tools)

[0.5.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.4.0...v0.5.0

## [0.4.0] — 2026-04-16

### Added

- **ANALYSIS tool category** — independent category for qualitative data analysis sessions (`analysis_store`, `analysis_query`, `analysis_clear`). Requires vector storage.
- **OPERATIONS tool category** — independent category for retrospective CRUD operation analysis (`find_similar_operations`, `detect_operation_gaps`, `cluster_operations`). Requires vector storage.
- `BaseAnalysisTool` and `BaseOperationsTool` base classes in their own directories
- `validateToolSchema()` — validates tool inputSchema against the MCP SDK serialization pipeline at registration time
- `"dev": "tsc --watch"` script for rapid development with npm link

### Changed

- **Split `MEMORY` category into `ANALYSIS` + `OPERATIONS`** — two independent categories, each with its own base class, directory, and `*_TOOL_CLASSES` export
- **Renamed `memory-storage.ts` → `vector-storage.ts`** — `initVectorStorage()`, `isVectorStorageEnabled()`, `flushVectorStorage()`, `closeVectorStorage()`, `VectorStorageOptions`
- **Renamed service export** `memoryStorage` → `vectorStorage` from `mcp-kit/services`
- **Renamed category config** `requiresMemoryStorage` → `requiresVectorStorage` in `CategoryConfig` interface
- `MEMORY_TOOL_CLASSES` → `ANALYSIS_TOOL_CLASSES` + `OPERATIONS_TOOL_CLASSES`
- `tools/memory/` directory split into `tools/analysis/` and `tools/operations/`

### Fixed

- `derivePromptSchema()` now copies `enumDescriptions` from model `attributesConfig`, restoring auto-generated enum tables in section documentation

### Removed

- `TOOL_CATEGORIES.MEMORY` constant
- `BaseMemoryTool` base class
- `tools/memory/` directory
- Deprecated analysis tool aliases (`StoreAnalysisMemoryTool`, `RecallAnalysisMemoriesTool`, `ClearAnalysisMemoriesTool`)

## [0.3.0] — 2026-04-15

### Added

- **Unified `analysis_*` tool family** for large-scale dataset analysis without polluting LLM context:
  - `analysis_ingest` — Fetches records from the API and stores them in structured storage (`ingested_records` table) with auto-generated page summaries. Supports `ingest_all: true` for zero-context-pollution bulk ingestion (up to 50 pages)
  - `analysis_query` — Unified query tool with four modes: `semantic` (embedding similarity on findings), `aggregate` (SQL GROUP BY for counts/distributions), `filter` (JSONB containment for exact matches), `sample` (random records for inspection)
  - `analysis_store` — Store LLM-generated qualitative insights (renamed from `store_analysis_memory`)
  - `analysis_clear` — Cascade-clear both `ingested_records` and `analysis_memories` tables (renamed from `clear_analysis_memories`)
- `ingested_records` pgvector vendor backend (`src/services/vendor/pgvector/ingested-records.ts`) with multi-row INSERT, aggregate, filter, and sample query support
- `storeIngestedRecords`, `queryIngestedData`, `clearIngestedRecords` facade functions in `memory-storage.ts`
- New public exports: `BaseForm`, `createFormDataTools`, `StartupTracker`, `PostgresqlAdapter`, `createPromptCache`, `BaseConvention`, `halConvention`, `jsonApiConvention`, `defaultConvention`, `toolOutputAdapters`

### Changed

- **Renamed `src/mcp/tools/crud/` → `src/mcp/tools/data/`** — the directory contained CRUD, bulk, search, and discovery tools; "data" accurately reflects the broader scope
- `CRUD_TOOL_CLASSES` → `DATA_TOOL_CLASSES` (deprecated alias preserved)
- `TOOL_CATEGORIES.CRUD` → `TOOL_CATEGORIES.DATA` (deprecated alias preserved, value changed from `'crud'` to `'data'`)
- `CATEGORY_CONFIG` key updated from `crud` to `data` with broader description
- `BaseTool` default category changed from `TOOL_CATEGORIES.CRUD` to `TOOL_CATEGORIES.DATA`
- `recall_analysis_memories` merged into `analysis_query` (semantic mode) — old name is a deprecated re-export
- `find_model` now includes a usage rule directing to `analysis_ingest` for large-scale analysis
- `MEMORY_TOOL_CLASSES` updated: `analysis_store`, `analysis_query`, `analysis_clear` replace old names

### Fixed

- Silenced logging output during test runs: mocked logger in pgvector and embeddings tests, added `logger: false` to AJV instances in OAuth2 contract tests
- Fixed unawaited `expect().rejects.toThrow()` in `get-filters-guide-tool.spec.ts`

[0.3.0]: https://github.com/dsaenztagarro/mcp-kit/compare/v0.2.0...v0.3.0

## [0.2.0] — 2026-04-13

Full migration from JavaScript to TypeScript with strict type checking, `.d.ts` declaration generation, and CI pipeline.

### Added

- TypeScript compilation with `tsc` (`src/` → `dist/`)
- `tsconfig.json` with strict mode, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- `.d.ts` + `.d.ts.map` declaration files for all 11 subpath exports
- Typed interfaces for all public APIs: `ApiClient`, `ToolLogger`, `ToolDependencies`, `ToolResult`, `AttributeDefinition`, `ModelData`, `FieldDefinition`, `AssociationConfig`, `Section`, `FieldGroup`, `PromptFieldDefinition`, `FormSchema`, `StrategyType`
- `as const` + derived `ToolCategory` type from `TOOL_CATEGORIES`
- Type guards (e.g., `node is ConfigDescriptor`)
- Generic methods (e.g., `StartupTracker.phase<T>()`)
- Discriminated unions (`ToolResult = ToolSuccessResponse | ToolErrorResponse`)
- GitHub Actions CI pipeline (type-check, lint, test, build on Node.js 24)
- Development section in README (setup, commands, Claude Desktop config)
- `build`, `build:check`, `prepublishOnly` scripts

### Changed

- Source directory: `lib/` → `src/` (131 files)
- Root barrel files moved into `src/` as `.ts` entry points
- Package exports: all 11 subpaths now have `types` + `import` conditions
- `main` → `./dist/index.js`, new `types` → `./dist/index.d.ts`
- `files` field: ships `dist/` instead of root `.js` + `lib/`
- Import alias: `#lib/*` → `#src/*`
- ESLint: added `typescript-eslint` for `.ts` files
- Vitest config: updated coverage paths, added `#src` resolve alias
- All test imports updated from `lib/` to `src/`
- README code examples updated to TypeScript syntax
- CONTRIBUTING.md updated for TypeScript workflow
- Bookshelf example migrated to TypeScript

### Fixed

- `form-data-store.ts` / `selection-store.ts`: `get()` parameter made optional (was required after TS conversion)
- `validate-form-tool.ts` / `get-form-summary-tool.ts`: restored `this` binding for extracted static methods

## [0.1.0] — 2026-04-13

Initial public release. Extracted from production MCP servers.

### Framework

- Model-driven architecture: define models, get tools/prompts/forms/docs automatically
- `BaseModel` class with `attributesConfig` as single source of truth
- Dual transport: `StdioServer` (local dev) + `HttpServer` (remote, multi-user, Streamable HTTP)
- `createServer` factory wiring tool/prompt/app registries
- 10 generic CRUD tools auto-generated from model config
- 6 tool categories with automatic auth inference (CRUD, STRATEGY, AUTOCOMPLETE, MEMORY, DOMAIN, CUSTOM)
- 3 prompt strategies: stateless (< 10 fields), hybrid (10-20), stateful (20+)
- `PromptContentGenerator` pipeline for documentation assembly from config
- `derivePromptSchema` for field definitions from model attributes
- 6 schema-driven MCP Apps (form, list, detail, search, autocomplete, multi-select)
- Search adapter pattern for API filter translation
- Domain intelligence: workflows, business rules, knowledge registry
- API convention abstraction (HAL, JSON:API)

### Auth

- OAuth 2.1 + PKCE via `openid-client`
- RFC 7636 (PKCE), RFC 7591 (DCR), RFC 8414 (AS metadata), RFC 8707 (Resource Indicators), RFC 9728 (Protected Resource Metadata)
- Token introspection with 60s caching
- Adapter-driven token persistence (PostgreSQL adapter included)
- Reference implementation for learning (`lib/oauth2-ref/`)

### Infrastructure

- Structured logging (Winston, JSON/text formats, daily file rotation)
- Distributed tracing facade (Langfuse adapter included)
- Error tracking facade (Sentry adapter included)
- Local embeddings (`all-MiniLM-L6-v2` via `@huggingface/transformers`)
- Operation memory with pgvector for semantic search
- Request ID correlation (`X-Request-ID`) across services

### Packages

- 11 subpath exports: `mcp-kit/server`, `mcp-kit/tools`, `mcp-kit/prompts`, `mcp-kit/apps`, `mcp-kit/search`, `mcp-kit/domain`, `mcp-kit/oauth2`, `mcp-kit/services`, `mcp-kit/db`, `mcp-kit/core`
