# Adapters

Replace a built-in default without forking — the API client, wire convention, data backend, or search translation. Each is one typed seam.

**Read in this order:**

1. [Custom API client](./api-client.md) — the universal CRUD HTTP contract every authenticated tool and ModelService depends on
2. [Custom API convention](./api-convention.md) — payload wrapping, association ID translation, list/response unwrapping
3. [Custom DataLayer](./data-layer.md) — the seam between mcp-rune's projection layer (CRUD, prompts, apps, workflows) and any concrete data backend
4. [Custom search adapter](./search-adapter.md) — translate `{ query, filters, page, perPage }` into your API's request shape
