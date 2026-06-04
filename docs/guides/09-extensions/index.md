# Extensions

Add new capability on top of the framework: HTTP routes, tool-flow hooks, custom MCP apps, and ModelService verbs beyond plain CRUD.

**Read in this order:**

1. [Extensions overview](./extensibility.md) — tour the seams: convention, client, data layer, search adapter, and the two extension shapes
2. [Extension recipes](./extension-recipes.md) — the inverse map: "I want to do X, which seam does that?" Copy-pasteable starting points
3. [Authoring extensions](./authoring-extensions.md) — end-to-end walkthrough of writing an extension from scratch
4. [API extensions](./api-extensions.md) — contribute MCP tools and ModelService methods beyond pure CRUD
5. [Tool-flow extensions](./tool-flow-extension.md) — modify the MCP tool surface and the runtime context threaded into app tool handlers
6. [HTTP extensions](./extensions-http.md) — opt-in HTTP extensions add routes and middleware on top of the framework's OAuth, status, and MCP transport endpoints
7. [Writing a custom MCP app](./custom-app.md) — build a seventh MCP app: kind taxonomy, formatter registry, form-schema generator, selection store, theming
