# Subpath Imports

mcp-rune ships as a single npm package but exposes its capabilities through **subpath imports** so you only pull what you need into a given file. Each entry below maps to a single concern — the imports are intentionally siloed so it's obvious where a symbol lives without a directory tour.

## Reference

```ts file=examples/subpath-imports-01.ts
import { BaseModel } from '@mcp-rune/mcp-rune/models'
import type { AttributeDefinition, AssociationConfig } from '@mcp-rune/mcp-rune/models'

import type { ApiClient, RequestOptions } from '@mcp-rune/mcp-rune/core'
import { loadConfig } from '@mcp-rune/mcp-rune/core'

import { StdioServer, HttpServer, createServer } from '@mcp-rune/mcp-rune/server'

import {
  BaseTool,
  ToolRegistry,
  TOOL_CATEGORIES,
  DATA_TOOL_CLASSES,
  FORM_STRATEGY_TOOL_CLASSES
} from '@mcp-rune/mcp-rune/tools'
import { wrapToolHandler, loggingInterceptor, errorInterceptor } from '@mcp-rune/mcp-rune/tools'
import type { ToolInterceptor, ToolContext, ToolRegistryConfig } from '@mcp-rune/mcp-rune/tools'

import { DataLayer } from '@mcp-rune/mcp-rune/data-layer'
import { ModelService, EndpointResolver } from '@mcp-rune/mcp-rune/model-service'
import { jsonApiConvention, defaultConvention } from '@mcp-rune/mcp-rune/api-conventions'

import { BasePrompt, PromptContentBuilder, derivePromptSchema } from '@mcp-rune/mcp-rune/prompts'

import {
  AppRegistry,
  createDefaultAppRegistry,
  createFindModelApp,
  createShowModelApp,
  createPickModelApp
} from '@mcp-rune/mcp-rune/apps'

import { SearchService, SearchRequestShaper } from '@mcp-rune/mcp-rune/api-extensions/search'
import { customActionsExtension } from '@mcp-rune/mcp-rune/api-extensions/custom-actions'

import { DomainRegistry, WorkflowDefinition } from '@mcp-rune/mcp-rune/domain'

import { OAuthService } from '@mcp-rune/mcp-rune/oauth2'

import { cimdExtension } from '@mcp-rune/mcp-rune/extensions/cimd'
import { centerOfControlExtension } from '@mcp-rune/mcp-rune/extensions/center-of-control'

import { logger, tracing, errorTracking, vectorStorage } from '@mcp-rune/mcp-rune/runtime'
import { createPgvectorAdapter } from '@mcp-rune/mcp-rune/runtime/vendor/pgvector'

import { setPool, query } from '@mcp-rune/mcp-rune/db'
import { migrations } from '@mcp-rune/mcp-rune/db/migrations'
```

```js file=examples/subpath-imports-01.js
export {}
```

## Map by concern

| Subpath | What lives there |
| --- | --- |
| `@mcp-rune/mcp-rune/core` | Framework primitives — `ApiClient` (type), `Config`, `loadConfig`, env helpers, response helpers, startup tracker. **Does NOT contain `BaseModel`** — that moved to `/models`. |
| `@mcp-rune/mcp-rune/models` | `BaseModel`, `AttributeDefinition`, `AssociationConfig`, the 17 built-in kind descriptors. |
| `@mcp-rune/mcp-rune/server` | `StdioServer`, `HttpServer`, `createServer` factory. |
| `@mcp-rune/mcp-rune/tools` | `BaseTool`, `ToolRegistry`, `DATA_TOOL_CLASSES`, `FORM_STRATEGY_TOOL_CLASSES`, interceptors, types. |
| `@mcp-rune/mcp-rune/data-layer` | `DataLayer` interface + in-memory stub. |
| `@mcp-rune/mcp-rune/model-service` | `ModelService`, `EndpointResolver` — the default `DataLayer` adapter. |
| `@mcp-rune/mcp-rune/api-conventions` | `BaseConvention`, `jsonApiConvention`, `defaultConvention` — the wire-format layer. |
| `@mcp-rune/mcp-rune/prompts` | `BasePrompt`, `PromptContentBuilder`, `derivePromptSchema`. |
| `@mcp-rune/mcp-rune/apps` | `AppRegistry`, `createDefaultAppRegistry`, generic app factories (`createFindModelApp`, `createShowModelApp`, `createPickModelApp`, `createMultiPickModelApp`, `createViewSelectionApp`, `createModelFormApp`, `createWorkflowPanelApp`). |
| `@mcp-rune/mcp-rune/apps/kind-renderers` | DOM kind renderers (`getKindRenderer`, `registerKindRenderer`, `renderCellValue`) for custom-app authors. |
| `@mcp-rune/mcp-rune/api-extensions` | `ApiExtension` contract. |
| `@mcp-rune/mcp-rune/api-extensions/custom-actions` | Built-in: per-model non-CRUD verbs. |
| `@mcp-rune/mcp-rune/api-extensions/search` | Built-in: `SearchService`, `SearchRequestShaper`, the `search_records` + `get_filters_guide` tools. |
| `@mcp-rune/mcp-rune/domain` | `DomainRegistry`, `WorkflowDefinition`, business-rule types. |
| `@mcp-rune/mcp-rune/oauth2` | `OAuthService` — issuance, introspection, revocation, refresh. |
| `@mcp-rune/mcp-rune/extensions` | `HttpExtension` contract; mount-order rules. |
| `@mcp-rune/mcp-rune/extensions/cimd` | Built-in: Client ID Metadata Document. |
| `@mcp-rune/mcp-rune/extensions/center-of-control` | Built-in: OAuth control-plane extension. |
| `@mcp-rune/mcp-rune/runtime` | `logger`, `tracing`, `errorTracking`, `embeddings`, `vectorStorage`, `requestContext`, `toolOutputAdapters` facades. |
| `@mcp-rune/mcp-rune/runtime/vendor/pgvector` | `createPgvectorAdapter` — `VectorStorageAdapter` backed by Postgres + pgvector. |
| `@mcp-rune/mcp-rune/db` | `setPool`, `query` — minimal PG client. |
| `@mcp-rune/mcp-rune/db/migrations` | Versioned SQL migrations as a JS array — feed to your migration runner. |

## Why subpath imports

Importing from `@mcp-rune/mcp-rune` would pull every dependency (winston, openid-client, pg, transformers) into tree-shaking territory. Subpaths keep cold-start cost honest: a `StdioServer` with no analysis tools never loads `@huggingface/transformers`. Each subpath corresponds to a stable seam in the framework, so renaming or moving an internal file does not break consumers.

The full exports map is the authoritative source — see the `"exports"` field in `package.json`.
