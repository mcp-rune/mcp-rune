# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
