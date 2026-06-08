# The Prompt

Chapter 2 ended with a Model — a static declaration that exists, but does nothing on its own. This chapter introduces the first thing that _reads_ a Model: the Prompt. Where the Model defines the nouns (what fields exist, what kinds they are, how they associate), the Prompt defines the verbs of reasoning — how an LLM should think about and fill the form your Model implies.

A Prompt is itself a class. It declares **sections** (the user-facing chapters of the form), **field groups** (the validation-facing partitions), and an optional **strategy** (`stateless`, `hybrid`, or `stateful`). The framework derives the rest from the underlying Model: the schema, the required-field check, the kind-aware input hints, the LLM-facing summary of the current form state.

**Read in this order:**

1. [Prompt creation](./prompt-creation.md) — the `BasePrompt` shape: sections, field groups, `formStrategy`, the `promptContent` getter, and the `derivePromptSchema(Model, …)` call that ties a prompt back to its model.
2. [Derivation framework](./prompt-derivation.md) — the five-layer architecture: schema → grouping → section docs → assembly → behavioral instructions. The exact path from `attributes` to the string the LLM reads.
3. [Sections & field groups](./sections-groups.md) — why the user-facing partition is not the same as the validation-facing partition, and when they diverge.
4. [Stateful strategies](./stateful.md) — turn-taking, section-by-section validation for prompts with 20+ fields.

Once a Prompt knows how to teach an LLM to fill a Model's form, the next question is: _what runs when the form is submitted?_ That's [chapter 4](../04-tools/) — Tools.
