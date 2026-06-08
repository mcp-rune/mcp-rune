# The Model

The Quickstart showed you a working server. This section answers the question that the Quickstart deliberately glossed over: **what exactly is a Model, and why does the rest of the framework derive from it?**

The Model is mcp-rune's single source of truth. Every prompt, every tool, every form, every validation pass, every doc page, every analysis projection reads from one place — the static class declaration you write in `models/`. Nothing in the framework asks you to repeat that information anywhere else; everything else is derivation.

That makes this section the foundation for everything in Parts I and II. The chapters that follow — Prompts (chapter 3), Tools (chapter 4), Apps (chapter 5), and the three layers behind them (chapter 6) — all assume you know what's in a Model declaration and how kinds, associations, validation, and defaults shape what gets derived.

**Read in this order:**

1. [Defining a model](./defining-a-model.md) — `BaseModel`, the static fields the framework reads, and the smallest realistic example.
2. [Attributes and kinds](./attributes-and-kinds.md) — the `type:` taxonomy (17 built-in kinds) and how a single attribute value moves through API ⇄ internal ⇄ HTML representations.
3. [Associations](./associations.md) — `belongsTo` and `hasMany`, how foreign keys are inferred, and what derivation gets from them.
4. [Validation and defaults](./validation-and-defaults.md) — `required`, `default`, `validation: { min, max }`, and what fires at form-validate time vs at write time.
5. [Definition vs consumption](./definition-vs-consumption.md) — why model code lives in `models/` and the helpers that consume it live in sibling layers. The architectural seam the next chapter builds on.
6. [Derivation overview](./derivation-overview.md) — a map of every surface that's auto-built from your Model declaration, with pointers to the chapters that cover each one.

When you finish chapter 6, you'll have the full mental model needed to read chapter 3 (Prompt) the way the framework treats it: not as an independent thing, but as a Model projection with reasoning rules layered on top.
