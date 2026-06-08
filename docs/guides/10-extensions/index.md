# Extensions

Everything in Parts I–III happened _inside_ the framework's seams. This part is about adding new capability _across_ those seams without forking. By now you've met the three-layer story (chapter 4 & 6) and seen the surfaces extensions can contribute to — DataLayer adapters, conventions, search shapers, ApiExtensions, tool-flow hooks, HTTP routes, custom apps. This section is the inverse map: "I want to do X — which seam, and what's the boilerplate?"

The principle the whole framework is held to (and the eslint guard enforces): an extension is the right answer when the existing seams can host the new capability. Bypassing the seams to reach internal helpers isn't an extension — it's a fork.

**Read in this order:**

1. [Extensions overview](./extensibility.md) — tour the seams: convention, client, data layer, search shaper, and the three extension shapes (`HttpExtension`, `ApiExtension`, `ToolFlowExtension`).
2. [Extension recipes](./extension-recipes.md) — the inverse map: "I want to do X, which seam does that?" Copy-pasteable starting points.
3. [Authoring extensions](./authoring-extensions.md) — end-to-end walkthrough of writing an extension from scratch.
4. [API extensions](./api-extensions.md) — contribute MCP tools and DataLayer methods beyond pure CRUD.
5. [Tool-flow extensions](./tool-flow-extension.md) — modify the MCP tool surface and the runtime context threaded into app tool handlers.
6. [HTTP extensions](./extensions-http.md) — opt-in HTTP extensions add routes and middleware on top of the framework's OAuth, status, and MCP transport endpoints.
7. [Writing a custom MCP app](./custom-app.md) — build an additional MCP app: kind taxonomy, formatter registry, form-schema generator, selection store, theming.

Reference material — the package's subpath imports and the PostgreSQL schema for the analysis layer — lives in [chapter 11](../11-reference/).
