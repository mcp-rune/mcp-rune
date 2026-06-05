# Development

This file covers contributor setup, local commands, and the build pipeline. For repo policies (commit style, PR flow), see [CONTRIBUTING.md](CONTRIBUTING.md). For the framework itself, start with the [docs site](https://mcp-rune.dev).

> [!NOTE]
> The `dist/` directory is gitignored and compiled from `src/`. A **post-merge** git hook automatically runs `npm run build` after `git pull` when source files changed, so your local build stays fresh across machines. To rebuild manually: `npm run build` (TypeScript only — fast iteration) or `npm run build:full` (Vite apps + tsc + copy HTML — full publishable artifact).

## Prerequisites

- Node.js >= 24.0.0
- npm >= 11.6.0

## Setup

```bash
git clone https://github.com/mcp-rune/mcp-rune.git
cd mcp-rune
npm install
npm run build:full
```

## Commands

```bash
# Type check (no output, fast feedback)
npm run build:check

# Build all Vite UI apps (single-file HTML bundles)
npm run build:all-apps

# Compile TypeScript → dist/ (TS only — fast iteration)
npm run build

# Full pipeline from scratch (Vite apps + tsc + copy)
npm run build:full

# Run the test suite
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Coverage report (thresholds: 80% statements, 73% branches)
npm run test:coverage

# Lint and format
npm run lint
npm run format
```

## Testing changes against a real server

Runnable example servers live in their own repo: [`mcp-rune/examples`](https://github.com/mcp-rune/examples). To smoke-test framework changes against the bookshelf example pointed at your local checkout:

```bash
# In a scratch directory
npx @mcp-rune/create new my-app --template bookshelf --mcp-rune-local /path/to/mcp-rune
cd my-app
npx tsx server.ts
```

`--mcp-rune-local` rewrites the `@mcp-rune/mcp-rune` dependency to `file:/path/to/mcp-rune`, so changes you make in `src/` flow through without reinstall.

## Claude Desktop configuration

Add the scaffolded server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bookshelf": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/my-app/server.ts"]
    }
  }
}
```

## Tech stack

- **Language:** TypeScript 5.9 (strict mode, compiled with `tsc`)
- **Runtime:** Node.js >= 24 (ES modules)
- **MCP SDK:** `@modelcontextprotocol/sdk` (spec 2025-11-25)
- **Schema:** Zod v4
- **HTTP:** Express 5
- **OAuth2:** openid-client (RFCs 6749, 7591, 7636, 7662, 8414, 8707, 9728 + OIDC Core)
- **Database:** PostgreSQL
- **Apps:** Vite (build only)
- **Testing:** Vitest
- **CI:** GitHub Actions
