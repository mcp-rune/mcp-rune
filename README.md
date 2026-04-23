<p align="center">
  <a href="https://github.com/dsaenztagarro/mcp-kit/actions/workflows/ci.yml"><img src="https://github.com/dsaenztagarro/mcp-kit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/MCP-2025--06--18-blue" alt="MCP Spec" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-green" alt="Node.js" />
  <img src="https://img.shields.io/badge/tests-2177%20passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/coverage-81%25-yellow" alt="Coverage" />
  <img src="https://img.shields.io/badge/license-MIT-brightgreen" alt="License" />
</p>

# mcp-kit

**Batteries-included MCP framework.** Define models, get CRUD tools, prompt strategies, interactive apps, OAuth, and docs — the Rails of MCP servers.

mcp-kit is an opinionated, model-driven framework for building [Model Context Protocol](https://modelcontextprotocol.io/) servers. Like Rails was extracted from Basecamp, mcp-kit was extracted from production MCP servers that power real workflows daily.

```typescript
import { BaseModel } from 'mcp-kit/core'
import type { AttributeDefinition } from 'mcp-kit/core'

export class Book extends BaseModel {
  static override endpoint = 'books'
  static override attributes: Record<string, AttributeDefinition> = {
    title: { type: 'string', required: true, description: 'Book title' },
    author: { type: 'string', required: true, description: 'Author name' },
    status: { type: 'enum', enumValues: ['unread', 'reading', 'completed'], default: 'unread' },
    rating: { type: 'integer', description: 'Rating 1-5', validation: { min: 1, max: 5 } }
  }
}

// That's it. You now have:
//   list_models, find_model, create_model, update_model, delete_model
//   search_records, get_nested_resources, bulk_action_models, ...
//   + prompt guide with validation strategy
//   + interactive form app
//   + auto-generated documentation
//
// All tools are polymorphic — they work with every model you register.
// 10 models, still 10 tools. The LLM's context stays clean.
```

<details>
<summary>JavaScript version</summary>

```javascript
import { BaseModel } from 'mcp-kit/core'

export class Book extends BaseModel {
  static endpoint = 'books'
  static attributes = {
    title: { type: 'string', required: true, description: 'Book title' },
    author: { type: 'string', required: true, description: 'Author name' },
    status: { type: 'enum', enumValues: ['unread', 'reading', 'completed'], default: 'unread' },
    rating: { type: 'integer', description: 'Rating 1-5', validation: { min: 1, max: 5 } }
  }
}
```

</details>

---

## Table of Contents

- [Why mcp-kit?](#why-mcp-kit)
- [Features](#features)
  - [Polymorphic CRUD Tools](#polymorphic-crud-tools)
  - [Prompt Strategies](#prompt-strategies)
  - [API-Agnostic Integration](#api-agnostic-integration)
  - [Interactive MCP Apps](#interactive-mcp-apps)
  - [Domain Intelligence](#domain-intelligence)
  - [OAuth 2.1 + PKCE](#oauth-21--pkce)
  - [Dual Transport](#dual-transport)
  - [Observability](#observability)
- [Quick Start](#quick-start)
- [Database](#database)
- [Subpath Imports](#subpath-imports)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [Design Principles](#design-principles)
- [Comparison with Alternatives](#comparison-with-alternatives)
- [Development](#development)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)
- [License](#license)

---

## Why mcp-kit?

Every MCP framework today works at the **transport/tool** level. You register tools, handle HTTP, write one handler per operation per model. 10 models x 5 CRUD operations = 50 hand-written tool handlers. Tool lists bloat, LLM tool selection degrades, and you're maintaining boilerplate across every model.

mcp-kit works at the **application** level. You describe your domain, the framework builds the MCP surface:

```
  You write                         mcp-kit generates
 ┌──────────────────┐     ┌────────────────────────────────────────┐
 │  Model           │────▶│  Polymorphic CRUD tools (10 tools      │
 │  attributesConfig│     │    serve ALL models, not N x 5)        │
 └──────────────────┘     ├────────────────────────────────────────┤
 ┌──────────────────┐     │  Prompt guide with validation          │
 │  Prompt          │────▶│    (stateless / hybrid / stateful)     │
 │  fieldGroups     │     ├────────────────────────────────────────┤
 │  sections        │     │  Interactive Apps (form, list,         │
 └──────────────────┘     │    detail, search, autocomplete)       │
                          ├────────────────────────────────────────┤
                          │  Field documentation & reference       │
                          │    tables (auto-generated from config) │
                          └────────────────────────────────────────┘
```

### How It Compares

|                                     | Protocol Wrappers | API Converters | **mcp-kit** |
| ----------------------------------- | :---------------: | :------------: | :---------: |
| Transport (stdio + HTTP)            |        ✅         |       ✅       |     ✅      |
| Tool registration & schema          |        ✅         |       ✅       |     ✅      |
| OAuth 2.1 + PKCE                    |        ⚠️         |       ❌       |     ✅      |
| Polymorphic CRUD from model config  |        ❌         |       ⚠️       |     ✅      |
| Bulk operations (batch CRUD)        |        ❌         |       ❌       |     ✅      |
| API convention abstraction          |        ❌         |       ❌       |     ✅      |
| Prompt strategies (form validation) |        ❌         |       ❌       |     ✅      |
| Schema-driven interactive Apps      |        ⚠️         |       ❌       |     ✅      |
| Search adapters                     |        ❌         |       ❌       |     ✅      |
| Domain workflows & business rules   |        ❌         |       ❌       |     ✅      |
| Documentation generation pipeline   |        ❌         |       ❌       |     ✅      |

---

## Features

### Polymorphic CRUD Tools

10 generic tools serve your entire domain. Register 10 models or 100 — the tool count stays constant:

| Tool                        | Description                            |
| --------------------------- | -------------------------------------- |
| `list_models`               | Paginated listing with field selection |
| `find_model`                | Fetch a single record by ID            |
| `create_model`              | Create with attribute validation       |
| `update_model`              | Partial update                         |
| `delete_model`              | Destroy a record                       |
| `search_records`            | Full-text and filtered search          |
| `get_nested_resources`      | Fetch child resources                  |
| `get_filters_guide`         | Describe available filters for a model |
| `bulk_action_models`        | Batch create/update/delete             |
| `bulk_get_nested_resources` | Batch fetch nested resources           |

The LLM passes the model name as a parameter — `{ "model": "book", "attributes": {...} }`. Fewer tools = better LLM tool selection, smaller system prompts, more context window for actual work.

Tools declare a **category** and the framework infers auth requirements automatically:

```typescript
import { BaseTool, TOOL_CATEGORIES } from 'mcp-kit'

export class ArchiveProjectTool extends BaseTool {
  static override get category() {
    return TOOL_CATEGORIES.CUSTOM
  }

  override get name() {
    return 'archive_project'
  }

  override async execute({ project_id }: { project_id: string }) {
    return this.apiClient!.post(`/projects/${project_id}/archive`)
  }
}
```

<details>
<summary>JavaScript version</summary>

```javascript
import { BaseTool, TOOL_CATEGORIES } from 'mcp-kit'

export class ArchiveProjectTool extends BaseTool {
  static get category() {
    return TOOL_CATEGORIES.CUSTOM
  }

  get name() {
    return 'archive_project'
  }

  async execute({ project_id }) {
    return this.apiClient.post(`/projects/${project_id}/archive`)
  }
}
```

</details>

| Category       | Auth | Description                                  |
| -------------- | :--: | -------------------------------------------- |
| `CRUD`         | Yes  | Generic model operations                     |
| `STRATEGY`     |  No  | Prompt guidance & form validation            |
| `AUTOCOMPLETE` | Yes  | Field value suggestions                      |
| `MEMORY`       |  No  | Operation analysis (requires memory storage) |
| `DOMAIN`       |  No  | Business rules, workflows, knowledge         |
| `CUSTOM`       |  --  | Server-specific (you decide)                 |

### Prompt Strategies

How does an LLM correctly fill out a 25-field form? Most MCP servers don't try. mcp-kit provides three strategies that adapt validation UX to form complexity:

| Strategy      | Fields | Operations                                              | Use Case      |
| ------------- | ------ | ------------------------------------------------------- | ------------- |
| **Stateless** | < 10   | `getDocumentation`                                      | Simple forms  |
| **Hybrid**    | 10-20  | `getDocumentation`, `validateFields`, `generateSummary` | Medium forms  |
| **Stateful**  | 20+    | All above + `validateSection`, `getProgress`            | Complex forms |

```typescript
import { BasePrompt, derivePromptSchema, PromptContentGenerator } from 'mcp-kit/prompts'
import type { PromptContent } from 'mcp-kit/prompts'
import { Book } from '../models/book.js'

export class BookPrompt extends BasePrompt {
  static override strategy = 'hybrid' as const

  static override fieldGroups = {
    identity: { fields: ['title', 'author'], context: 'Book Identity', required: true },
    status: { fields: ['status', 'rating'], context: 'Reading Status' }
  }

  // Schema derived FROM model — model is the single source of truth
  static {
    const schema = derivePromptSchema(Book, { fieldGroups: this.fieldGroups })
    this.fieldGroups = schema.fieldGroups
    this.fieldDefinitions = schema.fieldDefinitions
  }

  override get promptContent(): PromptContent[] {
    return PromptContentGenerator.for(BookPrompt, 'book')
      .add('# Book Creation Guide\n\nCreate a new book in the library.')
      .standard() // flowDiagram → guidance → allSections → summary
      .toolUsage() // auto-generated from static config
      .attributeReference() // auto-generated field reference table
      .build()
  }
}
```

<details>
<summary>JavaScript version</summary>

```javascript
import { BasePrompt, derivePromptSchema, PromptContentGenerator } from 'mcp-kit/prompts'
import { Book } from '../models/book.js'

export class BookPrompt extends BasePrompt {
  static strategy = 'hybrid'

  static fieldGroups = {
    identity: { fields: ['title', 'author'], context: 'Book Identity', required: true },
    status: { fields: ['status', 'rating'], context: 'Reading Status' }
  }

  static {
    const schema = derivePromptSchema(Book, { fieldGroups: this.fieldGroups })
    this.fieldGroups = schema.fieldGroups
    this.fieldDefinitions = schema.fieldDefinitions
  }

  get promptContent() {
    return PromptContentGenerator.for(BookPrompt, 'book')
      .add('# Book Creation Guide\n\nCreate a new book in the library.')
      .standard()
      .toolUsage()
      .attributeReference()
      .build()
  }
}
```

</details>

The `PromptContentGenerator` pipeline assembles documentation from your model config — field tables, enum options, validation rules, workflow diagrams. Change the model, the docs update automatically.

### API-Agnostic Integration

mcp-kit connects to any REST API through pluggable **API conventions**:

| Convention   | `belongsTo`               | `hasMany`          |
| ------------ | ------------------------- | ------------------ |
| **HAL**      | `{rel}_link` + `{rel}_id` | `{singular}_ids[]` |
| **JSON:API** | `{rel}_id`                | `{singular}_ids[]` |

The convention handles payload wrapping, association resolution, and response normalization. Need a different API style? Implement a convention — the rest of the framework adapts.

**The service layer** (`ModelService` + `EndpointResolver`) sits between tools and the API client, providing a layered endpoint resolution chain inspired by Ember Data's Adapter pattern:

```
Per-action override → Collection override → Nested routing → Namespace → Base endpoint
```

Configure per-model namespaces, per-action endpoint overrides, or subclass `EndpointResolver` for full URL control — without changing model definitions or tool code.

**Search adapters** bridge mcp-kit's generic filter format to whatever the backend expects:

```typescript
import { SearchAdapter } from 'mcp-kit/search'

export class ActivitySearchAdapter extends SearchAdapter {
  override buildBody(query: string | null, filters?: Record<string, unknown>) {
    const body = super.buildBody(query, filters) as Record<string, unknown>

    // Transform: { duration_minutes: { from: 40, to: 120 } }
    //        →   { min_duration: 40, max_duration: 120 }
    const duration = filters?.duration_minutes as { from?: number; to?: number } | undefined
    if (duration) {
      body.min_duration = duration.from
      body.max_duration = duration.to
      delete (body.filters as Record<string, unknown>)?.duration_minutes
    }

    return body
  }
}
```

<details>
<summary>JavaScript version</summary>

```javascript
import { SearchAdapter } from 'mcp-kit/search'

export class ActivitySearchAdapter extends SearchAdapter {
  buildBody(query, filters) {
    const body = super.buildBody(query, filters)

    // Transform: { duration_minutes: { from: 40, to: 120 } }
    //        →   { min_duration: 40, max_duration: 120 }
    const duration = filters?.duration_minutes
    if (duration) {
      body.min_duration = duration.from
      body.max_duration = duration.to
      delete body.filters?.duration_minutes
    }

    return body
  }
}
```

</details>

### Interactive MCP Apps

Six schema-driven app types render interactive UI in the MCP host (Claude Desktop, VS Code, Cursor) via [`@modelcontextprotocol/ext-apps`](https://github.com/anthropics/anthropic-cookbook/tree/main/misc/model-context-protocol-apps):

| App                     | Description                             |
| ----------------------- | --------------------------------------- |
| **Model Form**          | Create/update forms from model schema   |
| **List View**           | Paginated browse with filters           |
| **Record Detail**       | View/edit a single record               |
| **Search View**         | Multi-model full-text search            |
| **Autocomplete Picker** | Type-ahead for `belongsTo` associations |
| **Multi-Select**        | Checkbox picker for `hasMany` relations |

Generated from the same `attributesConfig` that drives the tools and prompts. Adding a new model form = one registry entry, zero new HTML. This turns your MCP server from a tool collection into a full application with UI.

### Domain Intelligence

Encode business knowledge, rules, and operational workflows that guide the LLM:

```typescript
import { WorkflowDefinition } from 'mcp-kit/domain'

export const onboardNewUser = new WorkflowDefinition({
  name: 'onboard_new_user',
  description: 'Complete onboarding for a new team member',
  steps: [
    { name: 'create_user', tool: 'create_model', model: 'user' },
    {
      name: 'assign_role',
      tool: 'update_model',
      model: 'user',
      description: 'Set the role based on department'
    },
    {
      name: 'send_welcome',
      tool: 'send_notification',
      description: 'Trigger the welcome email sequence'
    }
  ],
  tips: ['Always check existing users before creating duplicates']
})
```

### OAuth 2.1 + PKCE

Production-grade OAuth2 built on [openid-client](https://github.com/panva/openid-client):

```
┌──────────────────────────────────────────────────────────────┬──────────────┐
│                     RFC / Specification                      │    Status    │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 9728 — Protected Resource Metadata                       │              │
│   • Origin-only form (/.well-known/oauth-protected-resource) │ Implemented  │
│   • §3.1 path-inserted form                                  │ Implemented  │
│   • WWW-Authenticate resource_metadata parameter             │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 8414 — Authorization Server Metadata Discovery           │              │
│   • Metadata proxy with endpoint rewriting                   │ Implemented  │
│   • OpenID Configuration alias                               │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 7591 — Dynamic Client Registration (DCR)                 │              │
│   • Registration proxy with fallback to pre-configured       │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 6749 — OAuth 2.0 Authorization Framework                 │              │
│   • Authorization Code Grant (with mandatory PKCE)           │ Implemented  │
│   • Client Credentials Grant (M2M)                           │ Implemented  │
│   • Refresh Token Grant (auto-refresh with 5 min buffer)     │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 7636 — Proof Key for Code Exchange (PKCE)                │              │
│   • S256 challenge method (mandatory for all flows)          │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 7662 — Token Introspection                               │              │
│   • Cached introspection (60s TTL, 100-entry LRU)            │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ RFC 8707 — Resource Indicators                               │              │
│   • Audience-restricted tokens via resource parameter        │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ Token Revocation                                             │ Implemented  │
├──────────────────────────────────────────────────────────────┼──────────────┤
│ OpenID Connect Core 1.0                                      │              │
│   • Discovery via openid-client                              │ Implemented  │
│   • UserInfo endpoint (fallback to introspection)            │ Implemented  │
└──────────────────────────────────────────────────────────────┴──────────────┘
```

```typescript
import { OAuthService } from 'mcp-kit/oauth2'

const oauth = new OAuthService({
  authServerUrl: process.env.AUTH_SERVER_URL,
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  redirectUri: `${BASE_URL}/oauth/callback`,
  scopes: 'read write'
})

await oauth.getValidAccessToken(sessionId) // auto-refreshes
await oauth.introspectToken(token) // cached 60s
await oauth.revokeToken(token)
```

### Dual Transport

Both transports share the same server factory — your tools, prompts, and apps work identically:

```typescript
import { StdioServer } from 'mcp-kit/server'
// Local development (spawned by Claude Desktop, Cursor, etc.)
new StdioServer({ accessToken: process.env.ACCESS_TOKEN, mcp: mcpConfig }).start()
```

```typescript
import { HttpServer } from 'mcp-kit/server'
// Remote access (multi-user, OAuth-protected)
new HttpServer({ port: 4100, oauth, mcp: mcpConfig }).start()
```

### Observability

- **Structured logging** — Winston with JSON/text formats, daily file rotation
- **Distributed tracing** — vendor-agnostic facade (Langfuse adapter included)
- **Error tracking** — facade with Sentry adapter
- **Request ID correlation** — `X-Request-ID` flows across all services
- **Embeddings** — local `all-MiniLM-L6-v2` for semantic search (optional)

---

## Quick Start

```bash
git clone https://github.com/dsaenztagarro/mcp-kit.git
cd mcp-kit/examples/bookshelf
npm install
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

This starts a working MCP server with a Book model, prompt strategy, and all 10 polymorphic tools. Open the MCP Inspector and try:

1. `get_prompt_guide` with `{ "model": "book" }` — see the auto-generated creation guide
2. `validate_form` with `{ "model": "book", "attributes": { "title": "Clean Code" } }` — see validation feedback

See the [bookshelf example](examples/bookshelf/) for the full source (~150 lines total).

---

## Database

mcp-kit uses PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension for token storage, operation memory, and analysis features. Database features are **opt-in** — if `DATABASE_URL` is not set, everything works without a database.

### Tables

| Table               | Feature    | Required When           | Purpose                                                        |
| ------------------- | ---------- | ----------------------- | -------------------------------------------------------------- |
| `oauth_sessions`    | `core`     | `DATABASE_URL` set      | OAuth2 token storage (access/refresh tokens per session)       |
| `tool_memories`     | `core`     | `DATABASE_URL` set      | Semantic operation memory (384-dim embeddings via pgvector)    |
| `analysis_memories` | `analysis` | `ANALYSIS_ENABLED=true` | Analysis findings with embeddings (ephemeral 1h or persistent) |
| `ingested_records`  | `analysis` | `ANALYSIS_ENABLED=true` | Temporary dataset storage for large-scale analysis (1h expiry) |

### Running Migrations

mcp-kit exports migration SQL via `mcp-kit/db/migrations`. Write a migration runner that suits your project — here's a minimal example:

```typescript
import pg from 'pg'
import { migrations } from 'mcp-kit/db/migrations'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

// Track applied migrations
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)

const { rows } = await client.query('SELECT version FROM schema_migrations')
const applied = new Set(rows.map((r) => r.version))

for (const migration of migrations) {
  if (applied.has(migration.version)) continue

  await client.query('BEGIN')
  await client.query(migration.up)
  await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
    migration.version,
    migration.name
  ])
  await client.query('COMMIT')
  console.log(`Applied: ${migration.version}_${migration.name}`)
}

client.release()
await pool.end()
```

To apply only a subset (e.g., skip analysis tables when `ANALYSIS_ENABLED` is false):

```typescript
const needed = migrations.filter(
  (m) => m.feature === 'core' || process.env.ANALYSIS_ENABLED === 'true'
)
```

### Environment Variables

| Variable           | Default | Description                                                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | —       | PostgreSQL connection string. When unset, all database features are disabled.                                             |
| `ANALYSIS_ENABLED` | `false` | Enable analysis tools (`analysis_ingest`, `analysis_query`, `analysis_store`, `analysis_clear`). Requires `DATABASE_URL`. |

---

## Subpath Imports

mcp-kit exposes modules via subpath imports for targeted usage:

```typescript
import { BaseModel } from 'mcp-kit/core'
import type { AttributeDefinition } from 'mcp-kit/core'
import { StdioServer, HttpServer, createServer } from 'mcp-kit/server'
import { BaseTool, TOOL_CATEGORIES, CRUD_TOOL_CLASSES } from 'mcp-kit/tools'
import type { ApiClient, RequestOptions, ToolDependencies } from 'mcp-kit/tools'
import { ModelService, EndpointResolver } from 'mcp-kit/lib/mcp/services/index.js'
import { BasePrompt, PromptContentGenerator, derivePromptSchema } from 'mcp-kit/prompts'
import { AppRegistry, createCreateFormApp } from 'mcp-kit/apps'
import { SearchService, SearchAdapter } from 'mcp-kit/search'
import { DomainRegistry, WorkflowDefinition } from 'mcp-kit/domain'
import { OAuthService } from 'mcp-kit/oauth2'
import { logger, tracing, errorTracking } from 'mcp-kit/services'
import { setPool, query } from 'mcp-kit/db'
import { migrations } from 'mcp-kit/db/migrations'
```

<details>
<summary>JavaScript version</summary>

```javascript
import { BaseModel } from 'mcp-kit/core'
import { StdioServer, HttpServer, createServer } from 'mcp-kit/server'
import { BaseTool, TOOL_CATEGORIES, CRUD_TOOL_CLASSES } from 'mcp-kit/tools'
import { ModelService, EndpointResolver } from 'mcp-kit/lib/mcp/services/index.js'
import { BasePrompt, PromptContentGenerator, derivePromptSchema } from 'mcp-kit/prompts'
import { AppRegistry, createCreateFormApp } from 'mcp-kit/apps'
import { SearchService, SearchAdapter } from 'mcp-kit/search'
import { DomainRegistry, WorkflowDefinition } from 'mcp-kit/domain'
import { OAuthService } from 'mcp-kit/oauth2'
import { logger, tracing, errorTracking } from 'mcp-kit/services'
import { setPool, query } from 'mcp-kit/db'
import { migrations } from 'mcp-kit/db/migrations'
```

</details>

---

## Architecture

```
your-server/                          (you write this)
    │
    ├─ models/                         Model definitions (attributesConfig)
    ├─ prompts/                        Prompt classes (fieldGroups + strategy)
    ├─ tools/                          Custom tools (extend BaseTool)
    ├─ domain/                         Workflows, rules, knowledge
    └─ servers/
        ├─ local.ts                    StdioServer entry point
        └─ remote.ts                   HttpServer entry point

mcp-kit/                              (the framework)
    │
    ├─ core                            BaseModel, ApiConfig, helpers, validators
    ├─ server                          StdioServer, HttpServer, createServer
    ├─ tools                           BaseTool, CRUD tools, categories
    ├─ mcp/services                    ModelService, EndpointResolver
    ├─ prompts                         BasePrompt, strategies, pipeline
    ├─ apps                            AppRegistry, 6 generic app factories
    ├─ domain                          Workflows, knowledge, business rules
    ├─ search                          SearchService, SearchAdapter
    ├─ oauth2                          OAuthService, token store
    ├─ services                        Logger, tracing, error tracking
    └─ db                              PostgreSQL client
```

---

## Documentation

### Guides

| Guide                                                                           | Description                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------- |
| [Tool Creation](docs/guides/tool-creation-guide.md)                             | Build custom tools with category-based auth  |
| [Prompt Creation](docs/guides/prompt-creation-guide.md)                         | Create prompts with the derivation framework |
| [Prompt Derivation Framework](docs/guides/prompt-derivation-framework-guide.md) | Deep dive into the generator pipeline        |
| [MCP Apps](docs/guides/mcp-apps-guide.md)                                       | Interactive UI forms and views               |
| [MCP Apps Architecture](docs/guides/mcp-apps-architecture.md)                   | Schema-driven app internals                  |
| [Model Form Customization](docs/guides/model-form-customization-guide.md)       | Customize form rendering                     |
| [Service Layer](docs/guides/service-layer-guide.md)                             | ModelService, EndpointResolver, namespaces   |
| [Search & Filters](docs/guides/search-filter-integration-guide.md)              | Search adapters and filter transformation    |
| [Domain Knowledge](docs/guides/domain-knowledge-guide.md)                       | Business rules, knowledge, workflows         |
| [Workflow Creation](docs/guides/workflow-creation-guide.md)                     | Multi-step operational workflows             |
| [OAuth2 Discovery](docs/guides/oauth2-discovery-flow.md)                        | OAuth2 server discovery (RFC 8414/9728)      |
| [Memory Architecture](docs/guides/analysis-memory-architecture.md)              | Operation memory and analysis caching        |
| [Transient Context](docs/guides/transient-context-protocol.md)                  | Stateless context handling protocol          |

### Operations

| Guide                                             | Description                      |
| ------------------------------------------------- | -------------------------------- |
| [Deployment](docs/operations/deployment.md)       | Production deployment with Kamal |
| [Observability](docs/operations/observability.md) | Logging, tracing, and monitoring |
| [Security](docs/operations/security.md)           | Security practices and hardening |

---

## Design Principles

- **Model is the single source of truth** — `attributesConfig` drives tools, prompts, forms, and docs
- **Convention over configuration** — sensible defaults, override when needed
- **Polymorphic tools** — 10 tools serve all models, keeping LLM context clean
- **Category-driven auth** — tools declare a category, the framework infers requirements
- **API-agnostic** — pluggable conventions and search adapters for any REST backend
- **Dependency injection** — the framework never reads env vars or hardcodes URLs
- **Pure framework** — zero domain knowledge; your server adds the domain

---

## Comparison with Alternatives

### vs. `@modelcontextprotocol/sdk`

The official SDK provides protocol primitives. mcp-kit builds on top — same protocol compliance plus an application framework. Use the SDK for a single custom tool. Use mcp-kit when you have models, CRUD, forms, and documentation.

### vs. `mcp-framework`

mcp-framework adds CLI scaffolding and directory-based tool discovery. mcp-kit adds a full model-driven architecture — one tool per operation serving all models, prompt strategies, interactive apps, search adapters.

### vs. FastMCP (Python)

FastMCP is the dominant Python framework with excellent DX. mcp-kit is the Node.js counterpart with a higher-level model-driven approach. FastMCP wraps functions as tools. mcp-kit derives entire tool suites from model definitions. They complement each other — FastMCP for Python, mcp-kit for Node.js.

### vs. Stainless / FastAPI-MCP

API converters generate tools from OpenAPI specs. mcp-kit goes the other direction — you define models and the framework handles both the MCP surface and the API communication, including payload conventions and search adapters.

---

## Development

### Prerequisites

- Node.js >= 24.0.0
- npm >= 11.6.0

### Setup

```bash
git clone https://github.com/dsaenztagarro/mcp-kit.git
cd mcp-kit
npm install
npm run build:full
```

### Commands

```bash
# Type check (no output, fast feedback)
npm run build:check

# Build all Vite UI apps (single-file HTML bundles)
npm run build:all-apps

# Compile TypeScript → dist/ and copy HTML apps
npm run build

# Full pipeline from scratch (Vite apps + tsc + copy)
npm run build:full

# Run all 2054 tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Coverage report (thresholds: 80% statements, 73% branches)
npm run test:coverage

# Lint and format
npm run lint
npm run format
```

### Starting servers

```bash
# Local development — stdio transport (spawned by Claude Desktop, Cursor, etc.)
npx tsx examples/bookshelf/server.ts

# Or compile first, then run with Node:
npm run build
node dist/examples/bookshelf/server.js
```

### Claude Desktop configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bookshelf": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-kit/examples/bookshelf/server.ts"]
    }
  }
}
```

---

## Tech Stack

- **Language:** TypeScript 5.9 (strict mode, compiled with `tsc`)
- **Runtime:** Node.js >= 24 (ES modules)
- **MCP SDK:** `@modelcontextprotocol/sdk` (spec 2025-06-18)
- **Schema:** Zod v4
- **HTTP:** Express 5
- **OAuth2:** openid-client (RFCs 6749, 7591, 7636, 7662, 8414, 8707, 9728 + OIDC Core)
- **Database:** PostgreSQL
- **Apps:** Vite (build only)
- **Testing:** Vitest (2054 tests, 81%+ coverage)
- **CI:** GitHub Actions

---

## Contributing

mcp-kit is extracted from production. Contributions welcome — especially:

- Search adapters (Elasticsearch, Algolia, Typesense)
- API conventions (GraphQL, gRPC)
- Database adapters (SQLite, MySQL, Turso)
- Examples and documentation

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

---

## License

MIT
