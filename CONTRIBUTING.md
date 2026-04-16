# Contributing to mcp-kit

Thanks for your interest in contributing! mcp-kit is extracted from production MCP servers and welcomes contributions that extend the framework.

## Prerequisites

- Node.js >= 24.0.0
- npm >= 11.6.0

## Setup

```bash
git clone https://github.com/dsaenztagarro/mcp-kit.git
cd mcp-kit
npm install
npm test
```

## Development

```bash
npm run build:check   # Type-check without emitting (fast feedback)
npm run build         # Compile TypeScript → dist/ (JS + .d.ts)
npm test              # Run all tests (1978 tests)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (thresholds: 92% statements, 85% branches)
npm run lint          # ESLint
npm run format        # Prettier
```

## Code Style

- TypeScript with `.js` extensions in imports (NodeNext module resolution)
- `import type` for type-only imports (`verbatimModuleSyntax: true`)
- `camelCase` for functions/variables, `SCREAMING_SNAKE_CASE` for constants
- `snake_case` for API attributes (Rails conventions)
- 2 spaces, single quotes, no semicolons, 100 char width
- See `.prettierrc` and `eslint.config.js` for full config
- Unused variables must start with `_`

## Testing

Tests use [Vitest](https://vitest.dev/) with `describe`/`it`/`expect` and `vi.mock`/`vi.hoisted` for mocking. Tests live in `__tests__/` mirroring the `src/` structure. Tests are TypeScript (`.spec.ts`) with vitest globals enabled — no need to import `describe`/`it`/`expect`/`vi` explicitly.

Coverage thresholds are enforced:

- Statements: 92%
- Branches: 85%
- Functions: 93%
- Lines: 92%

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for any new functionality
3. Ensure `npm run build:check`, `npm test`, and `npm run lint` pass
4. Keep PRs focused — one feature or fix per PR

## Contribution Areas

These are areas where contributions are particularly welcome:

### Search Adapters

New adapters that transform mcp-kit's generic filter format into specific API shapes:

- Elasticsearch / OpenSearch
- Algolia
- Typesense
- PostgreSQL full-text search (pg_trgm, tsvector)

### Database Adapters

Token store and memory storage adapters for:

- SQLite (local dev, single-user)
- MySQL
- Turso / LibSQL

### API Conventions

Payload shape conventions beyond HAL and JSON:API:

- GraphQL
- gRPC / Protobuf

### Examples

Working example servers demonstrating different use cases.

## Architecture

The `src/` directory is organized into modules:

| Module        | Description                                                      |
| ------------- | ---------------------------------------------------------------- |
| `core/`       | Config loader, helpers, validators, BaseModel                    |
| `db/`         | PostgreSQL client                                                |
| `mcp/`        | Server factory, transports, tools, prompts, apps, search, domain |
| `oauth2/`     | OAuth 2.1 service and token store                                |
| `oauth2-ref/` | Educational reference implementation                             |
| `services/`   | Logger, tracing, error tracking, embeddings, memory              |

Key principles:

- **src/ never reads env vars** — configuration is injected
- **src/ has no domain knowledge** — your server adds the domain
- **Category-driven auth** — tools declare category, framework infers auth
- **Model is source of truth** — `attributesConfig` drives everything

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
