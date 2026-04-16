# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
