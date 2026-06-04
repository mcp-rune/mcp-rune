# The Prompt DSL

The declarative language at the center of the framework. Sections describe the user journey; field groups carry validation. The framework writes everything in between.

**Read in this order:**

1. [Prompt creation](./prompt-creation.md) — stateless, hybrid, or stateful; sections vs field groups; per-section content enrichment
2. [Derivation framework](./prompt-derivation.md) — the 5-layer architecture: schema → grouping → section docs → assembly → behavioral instructions
3. [Sections & field groups](./sections-groups.md) — user-facing sections versus validation-facing field groups
4. [Stateful strategies](./stateful.md) — turn-taking, section-by-section validation for 20+ field workflows
5. [Attribute kinds](./attribute-kinds.md) — how a value moves through wire shape, validation, and render representations
