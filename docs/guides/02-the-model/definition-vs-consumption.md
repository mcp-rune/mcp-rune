> **Customization:** none — this chapter is the architectural rule for where declaration code lives versus where consumption code lives.
> It applies equally to mcp-rune itself (`src/mcp/models/` vs `src/mcp/model-layer/`) and to your own server (your `models/` folder vs how the framework reads them). The split is enforced by `no-restricted-imports`; you cannot bypass it.

# Definition vs consumption

You've now seen everything that goes _into_ a Model declaration. This chapter answers the next obvious question: _who reads it, and where does that reader live?_

mcp-rune answers with a single architectural rule: **what a thing IS lives in one folder; what consumes it lives in a sibling folder.** The rule applies to models, to prompts, and to every future declarative seam the framework adds.

## The split, in code

| Declaration                                         | Consumption                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/mcp/models/` — `BaseModel`, kinds, definitions | `src/mcp/model-layer/`, `src/mcp/data-layer/`, `src/mcp/analysis-layer/` |
| `src/mcp/prompts/` — `BasePrompt`, generators       | `src/mcp/prompt-layer/`                                                  |

`src/mcp/models/` contains:

- `base-model.ts` — the abstract class your models extend.
- `model-definitions.ts` — the type definitions (`AttributeDefinition`, `AssociationConfig`, …) you write against.
- `kinds/` — the 17 built-in kind descriptors (`string.ts`, `enum.ts`, `datetime.ts`, …) covered in chapter 2.

That's it. There is no logic in this folder that _reads_ a model: no derivation, no validation, no record transformation, no edge extraction. Everything that interprets a model lives one folder over, in `model-layer/`, `data-layer/`, or `analysis-layer/`.

## Why this matters to you

Three reasons. They get progressively more practical.

### 1. Adding a model touches one folder

When you write a new `Comment extends BaseModel`, you write one file in `models/`. Nothing in `model-layer/`, `data-layer/`, or `analysis-layer/` needs to change — those layers are model-agnostic. The framework binds each layer to your new model at construction time (`modelLayer('comment')`) and the derivation runs.

### 2. Reading framework code stays cheap

When you want to know "how does derivation actually work for `promptSchema`?", you open `src/mcp/model-layer/schema-derivation.ts`. When you want to know "how is `belongsTo` declared?", you open `src/mcp/models/model-definitions.ts`. The two questions never overlap, so you never have to grep one folder while reading the other.

### 3. The boundary is enforced

The next chapter (and chapter 4 in detail) will show that the three consumption folders are reached only through their interfaces — `DataLayer`, `ModelLayer`, `AnalysisLayer`. Code in `apps/`, `tools/`, `prompt-layer/`, and `data-layer/api-extensions/` is forbidden by `no-restricted-imports` from importing internal helpers from any of the consumption folders directly. The eslint guard makes the split a build error, not a guideline.

That guard is what makes the layer story _trustworthy_ downstream. Without it, "tools call DataLayer" would be a convention you could break by typo. With it, the framework knows that every projection-layer file talks only to the three layers, which is the precondition for the dependency injection covered in chapter 4.

## The same split for prompts

`src/mcp/prompts/` holds the declaration side: `base-prompt.ts`, `prompt-definitions.ts`, `prompt-content-builder.ts`, `association-transformers.ts`, `generators/`. A prompt class is purely descriptive — it declares `fieldGroups`, `sections`, a `promptContent` getter.

`src/mcp/prompt-layer/` holds the consumption side: `prompt-registry.ts`, `prompt-cache.ts`, `prompt-validator.ts`, `form-strategies/`, `api-conventions.ts`. These are the runtime pieces that _consume_ a prompt class to validate input, cache derived schemas, and route through the right form strategy.

When you author a `BookPrompt`, you write it in your server's `prompts/` folder (which is to your project what `src/mcp/prompts/` is to the framework). The framework's `prompt-layer/` reads it. You never reach across into `prompt-layer/` from inside your prompt class — the dependency only flows one way.

## What the next chapter assumes

You're now ready to read chapter 4 the way it's written. When that chapter says "tools call `this.dataLayer`, `this.modelLayer(name)`, and `this.analysisLayer(name)`", what it's actually saying is: tools consume the three peer interfaces in the consumption folders, while your models — and the framework's helpers that read them — stay quietly on the declaration side. The split is what makes the DI shape work.

But before we get there, chapter 3 introduces the Prompt. The Model is now fully covered as a declarative artifact; the Prompt is the first thing that _reads_ it.

## What's next

The last chapter of this section, [Derivation overview](./derivation-overview.md), is a one-page map of every framework surface that's derived from your Model declaration, with a pointer to the chapter that covers each one. Skim it before moving on, then chapter 3 picks up with the Prompt.
