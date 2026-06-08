# Tools

Chapter 3 ended with a Prompt that teaches an LLM how to fill the form your Model defines. This chapter answers: **what actually executes once the LLM submits?** Every executable surface the framework exposes is a Tool, and every Tool consumes the same three peer interfaces you'll meet first.

**Read in this order:**

1. [The three layers](./the-three-layers.md) — `DataLayer`, `ModelLayer`, `AnalysisLayer`: the three peer interfaces every Tool, App, and Prompt receives via DI. The foundation for everything that follows.
2. [Polymorphic tools](./polymorphic-tools.md) — the 9 bundled tools (6 CRUD + 3 form-strategy) that serve every model uniformly. Why the surface doesn't grow when your model count does.
3. [Tool creation](./tool-creation.md) — writing a `BaseTool` subclass when a bespoke verb doesn't fit the polymorphic shape. Pipeline, interceptors, validators.
4. [Workflow creation](./workflow-creation.md) — chaining multiple tool calls into an LLM-driven workflow with `get_workflow_step` and the `contextHints` protocol.

When you finish this section, [chapter 5](../05-apps/) picks up with the other consumer of the three layers: Apps, the human-facing iframe UIs.
