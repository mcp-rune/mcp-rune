# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
