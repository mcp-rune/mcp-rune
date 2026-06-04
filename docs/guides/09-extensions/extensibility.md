# Adapters & Extensions — Overview

mcp-rune is intentionally extensible at every layer. The framework ships sensible defaults for everything — a JSON:API convention, an axios-based HTTP client, seven MCP apps, three prompt strategies — and exposes a typed seam at each boundary so deployers can swap, extend, or compose without forking.

This page maps every extensibility surface to its dedicated guide and helps you pick the right seam for what you're trying to do. Read it first when you're standing up a non-default integration.

## Table of Contents

- [When Should I Extend?](#when-should-i-extend)
- [The Three Tiers](#the-three-tiers)
  - [Core Adapters](#core-adapters)
  - [Tool & App Extensions](#tool--app-extensions)
  - [HTTP & Transport](#http--transport)
- [Picking the Right Seam](#picking-the-right-seam)
- [Composing Extensions](#composing-extensions)
- [Conventions](#conventions)

## When Should I Extend?

Three quick checks before reaching for a seam:

1. **Is it a model-level concern?** Add it to the model — attributes, associations, validation, `api.endpoint`. Don't extend the framework if you're really declaring data.
2. **Is there a built-in already?** The framework ships `ModelService`, `jsonApiConvention`, an axios client, `customActionsExtension`, seven apps, three prompt strategies, the kind registry, OAuth2 service. Most projects use these as-is.
3. **Does the seam already exist?** This page is the index. If you see your concern here, follow the linked guide. If you don't see it, the framework probably doesn't expose that surface yet — open an issue.

If you genuinely need a new seam (response middleware, telemetry hooks, etc.), file an issue. mcp-rune adds seams when there's a real consumer; the framework deliberately avoids speculative abstractions.

The extensibility surface is organized in three tiers — pick the tier that matches the layer your concern lives at:

<!-- illustration: extensibility-overview#tiers -->

```
   ┌────────────────────────────────────────────────────────────┐
   │  Tier 3 — HTTP & Transport                                 │
   │  HttpExtension · OAuthService                              │
   │  (express routes, middleware, RFC discovery)               │
   ├────────────────────────────────────────────────────────────┤
   │  Tier 2 — Tool & App Extensions                            │
   │  ApiExtension · ToolFlowExtension · AppDefinition          │
   │  BasePrompt · custom BaseTool                              │
   │  (extend the MCP surface itself: tools, apps, prompts)     │
   ├────────────────────────────────────────────────────────────┤
   │  Tier 1 — Core Adapters                                    │
   │  DataLayer · ApiClient · BaseConvention · SearchAdapter    │
   │  Kinds (KindDescriptor / FormatterDescriptor)              │
   │  (data path: HTTP → normalize → CRUD → projection)         │
   └────────────────────────────────────────────────────────────┘
                              │
                              ▼  composition (bottom-up)
       Tier 1 powers Tier 2; Tier 2 powers Tier 3.
       A Tier 3 extension may rely on Tier 2 surfaces;
       a Tier 2 extension consumes Tier 1 through DataLayer.
```

Tier 1 is where the wire-format and HTTP plumbing lives — swap it when the backend's shape doesn't match the defaults. Tier 2 is where the MCP surface is shaped — add tools, apps, prompts, or summary strategies. Tier 3 is where HTTP-level concerns sit — webhooks, custom OAuth endpoints, health probes.

## The Three Tiers

### Core Adapters

The data path: HTTP transport → response normalization → model-aware CRUD → projection layer. Each step is a swappable seam.

| Surface                                              | What it owns                                                                                                                                    | Guide                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **`ApiClient`**                                      | HTTP verbs (`get/post/put/patch/delete`) against URLs. Auth header injection, transport choice (axios, fetch, gRPC bridge).                     | [Custom API Client](../08-adapters/api-client.md)         |
| **`BaseConvention`**                                 | Wire-format specifics: request payload wrapping, association resolution, list normalization, error parsing. The HAL/JSON:API/your-flavor logic. | [Custom API Convention](../08-adapters/api-convention.md) |
| **`DataLayer`**                                      | Model-aware CRUD over the API client + convention combo. The seam every tool, prompt, and app talks to.                                         | [DataLayer](../08-adapters/data-layer.md)                 |
| **`SearchAdapter`**                                  | Filter shaping: turn `filters: { author_id: 7 }` into Ransack `q[author_id_eq]=7` or Elasticsearch `term: { author_id: 7 }`.                    | [Custom Search Adapter](../08-adapters/search-adapter.md) |
| **Kinds (`KindDescriptor` + `FormatterDescriptor`)** | Attribute taxonomy: parse/serialize/toInput/fromInput/describe/validate. Drives forms, prompts, summaries, and display.                         | [Attribute Kinds](../02-prompt-dsl/attribute-kinds.md)    |

The composition (top to bottom): `DataLayer ← ModelService ← (ApiClient, BaseConvention)`. For text search and typeahead, the `search` extension ships a `SearchEnabledDataLayer` decorator that composes a `SearchService` and implements `searchNormalized` / `lookupNormalized` / `groupSearchNormalized` on the `DataLayer` interface — `AppRegistry` wraps the factory output automatically. Kinds are orthogonal — they describe attribute values, not transport.

> **Projection-layer rule.** Tools, apps, prompts, and domain workflows consume only the `DataLayer` interface — never `SearchService`, `ApiClient`, or `ModelService` directly. See [The Projection-Layer Rule](../08-adapters/data-layer.md#the-projection-layer-rule).

### Tool & App Extensions

Where the framework's tool surface and runtime context get extended.

| Surface                                | What it owns                                                                                                                                                                        | Guide                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ApiExtension`**                     | New MCP tools tied to the model layer (custom verbs like publish/archive, bulk ops, RPC). Optionally contribute `ModelService` mixins and `SummaryStrategy`s for `analysis_ingest`. | [API Extensions](./api-extensions.md) · [Summary Strategies](../05-retrieval-graphrag/summary-strategies.md) · [Authoring Extensions](./authoring-extensions.md)                    |
| **`ToolFlowExtension`**                | The tool/app pipeline: register additional app tools, flip form submit mode (`direct` ↔ `collect`), thread state into handlers via `provideContext`.                                | [Tool Flow Extension](./tool-flow-extension.md)                                                                                                                                     |
| **MCP Apps (`AppDefinition`)**         | New iframe widgets beyond the six the framework ships (calendars, dashboards, bulk-edit grids, printable artifacts).                                                                | [Custom MCP App](./custom-app.md) · [MCP Apps Guide](../04-apps-search-forms/mcp-apps.md) · [MCP Apps Architecture](../04-apps-search-forms/mcp-apps-arch.md)                       |
| **Prompts (`BasePrompt`, strategies)** | Domain-specific prompts: which model, which sections, which validation, which strategy (stateless / hybrid / stateful).                                                             | [Prompt Creation](../02-prompt-dsl/prompt-creation.md) · [Stateful Strategies](../02-prompt-dsl/stateful.md) · [Prompt Derivation Framework](../02-prompt-dsl/prompt-derivation.md) |
| **Custom tools (`ToolClass`)**         | Tools beyond CRUD/search/prompt: domain workflows, batch operations, anything model-agnostic.                                                                                       | [Tool Creation](../03-tools-and-services/tool-creation.md)                                                                                                                          |

The boundary worth knowing: `ApiExtension` is about extending the model layer (new tools, new `ModelService` methods); `ToolFlowExtension` is about extending the tool runtime (intercepting submission, threading context). Different lifetime, different shape.

### HTTP & Transport

Routes, middleware, and auth. Below the MCP protocol.

| Surface             | What it owns                                                                                                                | Guide                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **`HttpExtension`** | Express routes and route-scoped middleware on top of `/oauth/*`, `/health`, `/mcp`. Built-in example: CIMD client metadata. | [Extensions](./extensions-http.md) · [Authoring Extensions](./authoring-extensions.md) |
| **`OAuthService`**  | Authorization server discovery, token introspection, token exchange, audience validation per RFC 8707.                      | [OAuth 2.0 Discovery Flow](../06-auth-and-transport/oauth2-discovery.md)               |

`HttpExtension` is the only place to add a new HTTP route inside the same process as your MCP server. Don't sneak routes in elsewhere — the boundary is auditable on purpose.

## Picking the Right Seam

For first-contact "I want to do X — which seam?" questions, start at the **[Extension Recipes Cookbook](./extension-recipes.md)**. It's organized by deployer intent, ships paired TS+JS examples for each entry, and links back to the deeper guides for full reference.

The quick map below is the same table cross-referenced by the cookbook — read it as the index, the cookbook as the prose:

| What you want                                                      | Pick                                                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Add an ISBN attribute kind"                                       | [Attribute Kinds](../02-prompt-dsl/attribute-kinds.md) — declare `'string:isbn'` in `AppRegistry.formatters`.                                                             |
| "Render `boolean` as a toggle instead of a checkbox"               | [Attribute Kinds](../02-prompt-dsl/attribute-kinds.md) — DOM-only `registerFormatter` override.                                                                           |
| "My API isn't JSON:API"                                            | [Custom API Convention](../08-adapters/api-convention.md) · [recipe](./extension-recipes.md#swap-the-response-parsing-convention-for-one-model).                          |
| "My API takes filters as Rails Ransack `q[field_eq]`"              | [Custom Search Adapter](../08-adapters/search-adapter.md).                                                                                                                |
| "I need request signing / mTLS / per-tenant routing on every call" | [Custom API Client](../08-adapters/api-client.md).                                                                                                                        |
| "Stub the API for integration tests"                               | [DataLayer](../08-adapters/data-layer.md) · [recipe](./extension-recipes.md#stub-the-api-for-integration-tests).                                                          |
| "Add a `publish` / `archive` non-CRUD action to a model"           | [API Extensions](./api-extensions.md) · [recipe](./extension-recipes.md#add-a-non-crud-verb-to-a-model-publish-archive).                                                  |
| "Add a custom MCP tool unrelated to a model"                       | [Tool Creation](../03-tools-and-services/tool-creation.md) · [recipe](./extension-recipes.md#add-a-custom-mcp-tool-unrelated-to-a-model).                                 |
| "Change what `analysis_ingest` writes as the page summary"         | [Summary Strategies](../05-retrieval-graphrag/summary-strategies.md) · [recipe](./extension-recipes.md#add-a-new-way-to-summarize-a-page-of-records-for-analysis_ingest). |
| "Approve every write through Slack before it hits the API"         | [Tool Flow Extension](./tool-flow-extension.md) · [recipe](./extension-recipes.md#stage-a-write-for-human-review-before-submitting-to-the-api).                           |
| "Add a `/health/detailed` HTTP endpoint"                           | [Extensions (HttpExtension)](./extensions-http.md) · [recipe](./extension-recipes.md#add-an-http-route-inside-the-same-process).                                          |
| "Ship a Stripe-style integration that touches multiple surfaces"   | [recipe](./extension-recipes.md#add-a-feature-that-touches-more-than-one-surface-stripe-style-integration).                                                               |
| "Show a monthly calendar widget for bookings"                      | [Custom MCP App](./custom-app.md).                                                                                                                                        |
| "Customize the layout of the generic create form"                  | [Model Form Customization](../04-apps-search-forms/model-form.md) — no extension needed, just `static fieldsets`.                                                         |
| "Add a multi-section guided prompt for a complex model"            | [Stateful Strategies](../02-prompt-dsl/stateful.md).                                                                                                                      |
| "Wire OAuth2 for remote MCP clients"                               | [OAuth 2.0 Discovery Flow](../06-auth-and-transport/oauth2-discovery.md).                                                                                                 |
| "Generate prompt docs from model attributes"                       | [Prompt Derivation Framework](../02-prompt-dsl/prompt-derivation.md).                                                                                                     |

If your scenario isn't here and you can't pick from the table above, default to: change the **model**, not the **framework**. The model layer is where 80% of customization lives.

## Composing Extensions

Multiple extensions coexist in one server. The composition rules:

- **`HttpExtension`s** are keyed by user-chosen names in the `extensions` map. They register routes on a `pathPrefix` you control. Two extensions on different prefixes don't conflict; on the same prefix, ordering matters (first-registered wins). See [Authoring Extensions](./authoring-extensions.md) for the assembly contract.
- **`ApiExtension`s** are keyed in `apiExtensions` on `ToolRegistry`. They contribute MCP tools and `ModelService` mixins; tool names must be unique, mixins are merged in registration order.
- **`ToolFlowExtension`s** are keyed in `toolFlowExtensions` on the server factory. They register app tools and can call `setFormSubmitMode` and `provideContext`. If two extensions set the submit mode, last-write-wins — typically you compose Center-of-Control with auxiliary extensions, not with each other. See [Tool Flow Extension](./tool-flow-extension.md).
- **`provideContext`** is additive. Two extensions can each contribute a context key as long as the keys differ. The context bag is passed to every app tool's `handleToolCall`.

Capability declarations (`requires: ['apps']`) are validated **at boot**, before the server accepts connections. If an extension declares it needs `apps` and the host doesn't have an `AppRegistry`, the server refuses to start. That's deliberate: failures should be loud and early.

## Conventions

Every extensibility seam in mcp-rune follows the same shape, by design:

1. **Typed interface or base class.** The contract is in the codebase (`DataLayer`, `BaseConvention`, `ToolFlowExtension`, `ApiClient`, `KindDescriptor`). TypeScript guides you.
2. **Single registration point.** No discovery, no auto-loading, no plugin scanning. You write your extension; you pass it to the relevant registry.
3. **Opt-in capabilities.** Extensions declare what they need (`requires: ['apps']`); the host validates at boot.
4. **Composable, not subsumed.** Composition rules favor adding methods to context bags, prepending to lists, or layering decorators — never inheritance chains. The Center-of-Control extension doesn't subclass `ToolRegistry`; it threads a `FormDataStore` into the context.
5. **Pre-1.0, no back-compat.** When the framework introduces a new pattern, it deletes the old one. Don't write extensions that assume v0.49 APIs will stick around — track the [CHANGELOG](../../../CHANGELOG.md) at each release.

If you're writing an extension and the shape feels wrong, push back: the seam is probably misnamed, missing a method, or has the wrong scope. Open an issue with a concrete code sample.

---

**Where each guide lives in the Docs sidebar:**

- **Adapters & Extensions** (this section): the 7 dedicated guides above.
- **Tools & Services** (section III): [DataLayer](../08-adapters/data-layer.md), [Service Layer](../03-tools-and-services/service-layer.md), [API Extensions](./api-extensions.md), [Extensions](./extensions-http.md), [Authoring Extensions](./authoring-extensions.md), [Tool Creation](../03-tools-and-services/tool-creation.md).
- **Apps, Search & Forms** (section IV): [MCP Apps Guide](../04-apps-search-forms/mcp-apps.md), [MCP Apps Architecture](../04-apps-search-forms/mcp-apps-arch.md), [Model Form Customization](../04-apps-search-forms/model-form.md), [Search Filter Integration](../04-apps-search-forms/search-filters.md).
- **The Prompt DSL** (section II): [Prompt Creation](../02-prompt-dsl/prompt-creation.md), [Stateful Strategies](../02-prompt-dsl/stateful.md), [Prompt Derivation Framework](../02-prompt-dsl/prompt-derivation.md), [Sections & Field Groups](../02-prompt-dsl/sections-groups.md).
- **Auth & Transport** (section VI): [OAuth 2.0 Discovery Flow](../06-auth-and-transport/oauth2-discovery.md).

This section's guides are **new authoring walkthroughs** for surfaces that previously lacked dedicated docs. The existing guides above remain canonical for their topics; this section's overview links to them so deployers see the whole map.
