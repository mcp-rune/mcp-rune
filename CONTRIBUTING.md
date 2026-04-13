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
npm test              # Run all tests (1978 tests)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (thresholds: 92% statements, 85% branches)
npm run lint          # ESLint
npm run format        # Prettier
```

## Code Style

- ES modules (`"type": "module"`) with `.js` extensions in imports
- `camelCase` for functions/variables, `SCREAMING_SNAKE_CASE` for constants
- `snake_case` for API attributes (Rails conventions)
- 2 spaces, single quotes, no semicolons, 100 char width
- See `.prettierrc` and `eslint.config.js` for full config
- Unused variables must start with `_`

## Testing

Tests use [Vitest](https://vitest.dev/) with `describe`/`it`/`expect` and `vi.mock`/`vi.hoisted` for mocking. Tests live in `__tests__/lib/` mirroring the `lib/` structure.

Coverage thresholds are enforced:
- Statements: 92%
- Branches: 85%
- Functions: 93%
- Lines: 92%

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for any new functionality
3. Ensure `npm test` and `npm run lint` pass
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

The `lib/` directory is organized into modules:

| Module | Description |
|--------|-------------|
| `core/` | Config loader, helpers, validators, BaseModel |
| `db/` | PostgreSQL client |
| `mcp/` | Server factory, transports, tools, prompts, apps, search, domain |
| `oauth2/` | OAuth 2.1 service and token store |
| `oauth2-ref/` | Educational reference implementation |
| `services/` | Logger, tracing, error tracking, embeddings, memory |

Key principles:
- **lib/ never reads env vars** — configuration is injected
- **lib/ has no domain knowledge** — your server adds the domain
- **Category-driven auth** — tools declare category, framework infers auth
- **Model is source of truth** — `attributesConfig` drives everything

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
