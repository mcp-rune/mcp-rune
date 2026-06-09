# Domain adapters

`DomainRegistry` accepts any `DomainAdapter` — a storage backend for concepts, business rules, and workflows. This page explains the adapter design, when to use each option, and how rule evaluation works across adapter types.

## Why adapters, not a layer

Layers (`ModelLayer`, `AnalysisLayer`) project _local_ definitions — they always have code to process. A remote domain adapter (PGVector, Qdrant) has **no local config** — items come entirely from a database. Calling that a "layer" would leave an empty `domain-layer/` folder downstream. The adapter pattern (analogous to `BaseTokenStoreAdapter` in `src/oauth2/adapters/`) is a better fit: the interface lives inside the domain module's own `adapters/` folder.

## InMemoryDomainAdapter

The default adapter. Items are defined in code via `DomainModule` objects and served from in-process memory.

```ts
import { DomainRegistry, InMemoryDomainAdapter } from '@mcp-rune/mcp-rune/domain'
import type { DomainModule } from '@mcp-rune/mcp-rune/domain'

const taskModule: DomainModule = {
  concepts: taskConcepts,
  rules: taskRules,
  workflows: taskWorkflows
}

const domainRegistry = new DomainRegistry({
  adapter: new InMemoryDomainAdapter([taskModule, projectModule])
})
```

**Why InMemory is almost always the right choice:**

- Domain datasets are typically small (~20–200 items). MiniLM cosine similarity over 200 items takes microseconds.
- Items are authored code — they benefit from TypeScript types, git history, and refactoring tools.
- No infrastructure dependency: the server starts without a database.
- Semantic search is built in via `EmbeddingSearch` (same MiniLM model used by the analysis layer).

## Multiple modules

`InMemoryDomainAdapter` accepts an array. Items from all modules are merged:

```ts
new InMemoryDomainAdapter([catchupModule, dealsModule, rightsModule])
```

Each `DomainModule` owns one domain area. The adapter merges concepts, rules, and workflows from all modules into flat registries.

## Rule evaluation and closures

`BusinessRule.evaluate` is a JavaScript closure — it cannot be serialised to a database. The consequence:

- **InMemory:** full rule evaluation supported.
- **Remote adapters (future):** rules provided via `modules` are held in memory for evaluation; rule metadata (name, description, scope, severity) is stored in the database for listing/search. If no modules are provided, `evaluateRules` returns `{ passed: true, results: [] }`.

This is intentional. Rule logic belongs in code where it can be tested, reviewed, and versioned. A remote adapter is appropriate for the _discovery_ surface (semantic search over concepts and workflows), not for evaluation.

## Remote adapters (future)

Remote adapters (PGVector, Qdrant) are not yet shipped. They would suit use cases where:

- Knowledge is managed externally (web UI, CMS, admin panel) without a code deploy
- Multiple servers share one knowledge base
- The knowledge set grows beyond a few hundred items

Remote adapters require a seeding/sync mechanism (how items enter the database, how they stay consistent) that has no design yet. The `DomainAdapter` interface is stable — remote adapters can be added later without changing `DomainRegistry` or any tools.
