# Apps

Chapter 4 covered Tools — the verbs that run when an LLM submits. This chapter covers the other consumer of the three layers: **Apps**, the schema-driven HTML interfaces that render inside MCP clients (Claude Desktop, COC, MCP Inspector). Where Tools serve the LLM, Apps serve the human looking at the screen.

Apps are sandboxed iframes the server delivers via a `ui://` resource. They consume the same `DataLayer` / `ModelLayer` / `AnalysisLayer` injected into Tools (chapter 4's three-layer story applies unchanged), plus a small bidirectional message protocol (`ontoolinput`, `ontoolresult`, `callServerTool`) that lets the iframe call back to the server. The framework ships seven default apps that work out of the box for every model: `find_model_app`, `show_model_app`, `new_model_app`, `edit_model_app`, `pick_model_app`, `multi_pick_model_app`, `view_selection_app`.

**Read in this order:**

1. [MCP apps](./mcp-apps.md) — what an MCP app is, the bidirectional message protocol, and how the seven default apps work for every model with zero per-model code.
2. [Apps architecture](./mcp-apps-arch.md) — how the framework resolves a `ui://` resource, sandboxes the iframe, and wires the message channels.
3. [Model form customization](./model-form.md) — `BaseAppForm`, per-fieldGroup layout overrides, horizontal grids, row layouts — when the default synthesized form doesn't fit.

> Note: a dedicated `bookshelf-app` example variant (with custom `BaseAppForm` subclasses for `book_new_app`, `book_edit_app`, `book_show_app`) is a planned addition to the examples repo. Until it lands, the running examples in this section quote from `bookshelf/` and `bookshelf-graph/`'s use of the default app registry — which is where the synthesized defaults come from.

When you finish this section, [Part II](../06-the-three-layers-up-close/) picks up with the three layers up close — `DataLayer` (and its implementations), `ModelLayer`, `AnalysisLayer`. That section is for the moment you outgrow the in-memory stub and want to swap in a real backend, or extend one of the layers with new capability.
