> **Customization:** the default `DataLayer` adapter. Swap the whole DataLayer via `dataLayer:` on the Registry, or extend just this one (custom convention, custom endpoint resolution) by subclassing `ModelService`.

# Model service

`ModelService` is the **default `DataLayer` implementation** — the adapter your server uses unless you swap something else in. It composes three smaller primitives (`EndpointResolver`, `ApiClient`, and a convention) into the polymorphic CRUD surface every Tool and App calls.

You don't construct `ModelService` directly inside a tool — that would violate the layer discipline from [chapter 4](../04-tools/the-three-layers.md). You construct it in `config.ts` and pass it to the registry through the `dataLayer:` factory. Inside a tool, what you see is just `this.dataLayer`. This chapter is about the seam where `ModelService` _is_ constructed and what each of its collaborators does.

## The shape

```
   DataLayer (interface)
        ▲
        │ implements
        │
   ┌────┴─────────────────────────────────────────┐
   │  ModelService                                 │
   │                                                │
   │   find/list/dispatch dispatches on action,    │
   │   resolves URL via EndpointResolver,          │
   │   shapes payload via Convention,              │
   │   sends HTTP via ApiClient                    │
   │                                                │
   └────┬──────────┬──────────────────┬───────────┘
        │          │                  │
        ▼          ▼                  ▼
  EndpointResolver  Convention        ApiClient
  (URLs from        (payload shape    (HTTP verbs
   model name +      per model         against
   action)           or server-wide)   URLs)
```

`ModelService` itself is a thin orchestrator. The three pieces it composes are what you'd actually customize.

## When to use the default

The default `ModelService` is the right pick when:

- Your backend follows one of the bundled wire conventions (flat REST, JSON:API) — or you've written a custom convention against the convention seam.
- Each model maps to one endpoint, named conventionally (`Book` → `books`).
- Auth is bearer-token on the request and your `ApiClient` knows how to attach it.

When any of those isn't true, you have two options: extend `ModelService` via the seams below, or write your own `DataLayer` implementation entirely. The latter is one class with the methods listed in the [data layer chapter](./data-layer.md); the former is the path covered in the rest of this guide.

## `EndpointResolver` — URL composition

`EndpointResolver` answers "what URL backs `find('book', 42)`?" It does this via a layered resolution chain inspired by Ember Data's adapter pattern:

1. **Per-action endpoint override** declared on the model's `static api.endpoints`.
2. **Standard CRUD route** derived from `static api.endpoint` (`books` → `/books`, `/books/:id`).
3. **Compound-ID expansion** for nested resources (`books/:book_id/chapters/:id`).
4. **Custom `pathForType`** if the deployer overrides the namespacing rule.

You rarely touch `EndpointResolver` directly. You touch it indirectly when you declare a model's `api.endpoint`, when you wire `namespace:` on the registry, or when you declare `endpoints:` for non-CRUD actions. The [API configuration guide](./api-configuration.md) covers the declarative surface.

## `ApiClient` — HTTP verbs

`ApiClient` is the seam between `ModelService` and the actual HTTP library. The contract is small: `get`, `post`, `patch`, `put`, `delete`, each taking a URL and options, each returning a response with `data` and headers. The default ships axios under the hood.

`ApiClient` is its own seam because the right HTTP client is opinionated: some teams want fetch, some want an internal axios wrapper with custom retry/auth/telemetry, some want a typed contract layer like ts-rest. Naming the seam lets you swap without forking. Full coverage in [API client](./api-client.md).

## Convention — wire shape

A convention answers "what does the payload look like on the wire?" Flat REST puts the model fields at the top level; JSON:API wraps them in `data.attributes`. Your custom convention can do anything in between.

As of v0.85.0, the **default convention lives on `DataLayer`**, not on `BaseModel`. You set it via the `dataLayer` factory's `defaultConvention:` option (or implicitly through `ToolRegistry`'s `defaultConvention:` which forwards into the factory). Per-model overrides still live where they always did — on `static api.convention`.

```ts
import { jsonApiConvention } from '@mcp-rune/mcp-rune/api-conventions'

// File: tasks/models/task.ts
export class Task extends BaseModel {
  static override api = { endpoint: 'tasks', convention: jsonApiConvention }
  // …
}
```

The full convention contract — `serializePayload`, `parseResponse`, association translation, envelope stripping — is covered in [API convention](./api-convention.md).

## Swapping `ModelService` out

For most deployments you keep `ModelService` and customize its three collaborators. For two cases you want to bypass it entirely:

- **Tests / quickstart** — `createInMemoryDataLayer({ fixtures })` is a `DataLayer` implementation that lives entirely in memory. No `ModelService`, no `ApiClient`, no convention. The bookshelf quickstart uses it.
- **Wrapping a third-party client library** — Warp Drive / Ember Data, Zodios, ts-rest, an internal company data layer. Wrap the library's CRUD surface in something that satisfies the `DataLayer` interface and pass it to the registry. The projection layer doesn't notice.

In both cases you skip `ModelService` and supply a different `DataLayer` directly. Same one-line swap in `config.ts`.

## Adding search

`ModelService` covers CRUD. Search (free-text, filter pass-through, lookup, group search) is a separate concern bolted on by `SearchEnabledDataLayer`, which wraps any base `DataLayer` (in-memory or `ModelService`) and adds `searchNormalized`, `lookupNormalized`, `groupSearchNormalized`. The wrap is opt-in because not every backend has a search endpoint. See [data layer](./data-layer.md) for the wiring.

## What's next

The next chapter, [API client](./api-client.md), goes one level deeper into the HTTP seam — when to write a custom client, what the contract looks like, and how to wire bearer tokens, retries, and telemetry without leaking those concerns above the seam.
