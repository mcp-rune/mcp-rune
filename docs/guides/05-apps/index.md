# Apps

Chapter 4 covered Tools — the verbs that run when an LLM submits. This chapter covers the other consumer of the three layers: **Apps**, the schema-driven HTML interfaces that render inside MCP clients (Claude Desktop, MCP Inspector, and other MCP hosts). Where Tools serve the LLM, Apps serve the human looking at the screen.

Apps are sandboxed iframes the server delivers via a `ui://` resource. They consume the same `DataLayer` / `ModelLayer` / `AnalysisLayer` injected into Tools (chapter 4's three-layer story applies unchanged), plus a small bidirectional message protocol (`ontoolinput`, `ontoolresult`, `callServerTool`) that lets the iframe call back to the server. The framework ships seven default apps in convention-over-configuration style — `find_model_app`, `show_model_app`, `new_model_app`, `edit_model_app`, `pick_model_app`, `multi_pick_model_app`, `view_selection_app` — each gated by what a model actually supports rather than by per-model code: the form apps (`new_model_app` / `edit_model_app`) only list models that have a form class with at least one renderable field (an explicit `formClasses:` entry or the synthesized default), and text search in the finder and pickers is honored only for models with a search backend. An eighth app, the opt-in `workflow_panel_app`, is not part of the default registry at all — deployers wire it explicitly via `createWorkflowPanelApp` with their own workflow list and launcher tool.

**Read in this order:**

1. [MCP apps](./mcp-apps.md) — what an MCP app is, the bidirectional message protocol, and how the default apps cover every eligible model with zero per-model code.
2. [Apps architecture](./mcp-apps-arch.md) — how the framework resolves a `ui://` resource, sandboxes the iframe, and wires the message channels.
3. [Model form customization](./model-form.md) — extending `BaseAppForm` with custom `fields` and `fieldsets` and supplying it through `createDefaultAppRegistry`'s `formClasses:` map, for when the default synthesized form doesn't fit.

> Note: a dedicated `bookshelf-app` example variant — custom `BaseAppForm` subclasses (a trimmed, fieldset-grouped `BookForm` supplied via `formClasses:`) — is a planned addition to the examples repo. Until it lands, the running examples in this section quote from `bookshelf/` and `bookshelf-graph/`'s use of the default app registry — which is where the synthesized defaults come from.

When you finish this section, [Part II](../06-the-three-layers-up-close/) picks up with the three layers up close — `DataLayer` (and its implementations), `ModelLayer`, `AnalysisLayer`. That section is for the moment you outgrow the in-memory stub and want to swap in a real backend, or extend one of the layers with new capability.
