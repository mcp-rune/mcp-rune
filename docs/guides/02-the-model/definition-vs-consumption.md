> **Customization:** none — this chapter is the architectural rule for where declaration code lives versus where consumption code lives.
> It applies equally to mcp-rune itself (`src/mcp/models/` vs `src/mcp/model-layer/`) and to your own server (your `models/` folder vs how the framework reads them). The split is enforced by `no-restricted-imports`; you cannot bypass it.

# Definition vs consumption

You've now seen everything that goes _into_ a Model declaration. This chapter answers the next obvious question: _who reads it, and where does that reader live?_

mcp-rune answers with a single architectural rule: **what a thing IS lives in one folder; what consumes it lives in a sibling folder.** The rule applies to models, to prompts, and to every future declarative seam the framework adds.

## Try it — see the split inside the framework you installed

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.103.0 · Node 24.

Your `bookshelf-tour` project pulled the framework's compiled code into
`node_modules/@mcp-rune/mcp-rune/`. The same split this chapter describes
is visible there — three commands surface it.

**1. List the declaration folder vs the consumption folders**

```bash
cd /tmp/bookshelf-tour
ls node_modules/@mcp-rune/mcp-rune/dist/mcp/models | head -10
ls node_modules/@mcp-rune/mcp-rune/dist/mcp/model-layer | head -10
ls node_modules/@mcp-rune/mcp-rune/dist/mcp/data-layer | head -10
```

`models/` holds `base-model.js`, `model-definitions.js`, and a `kinds/`
subdirectory — declarations, no logic. `model-layer/` and `data-layer/`
hold every file that _reads_ a model declaration: schema derivation,
validation, the registry, the runtime services. Two folder names; two
roles.

**2. Open the eslint guard that enforces the split**

```bash
grep -A 3 "model-layer/derived-fields" node_modules/@mcp-rune/mcp-rune/eslint.config.js 2>/dev/null \
  || cat ~/Code/mcp-rune/eslint.config.js | grep -A 4 'no-restricted-imports'
```

The framework's own `eslint.config.js` declares:

```js
'no-restricted-imports': [
  'error',
  {
    patterns: [
      {
        group: [
          '#src/mcp/model-layer/derived-fields*',
          '#src/mcp/model-layer/field-names*',
          '#src/mcp/model-layer/schema-derivation*',
          '#src/mcp/model-layer/validators*'
        ],
        message:
          'Use the modelLayer factory (deps.modelLayer / context.modelLayer) instead of importing model-layer helpers directly.'
      }
      // …
    ]
  }
]
```

Code in `apps/`, `tools/`, and `data-layer/api-extensions/` can't reach
into `model-layer` internals — they get the bound `modelLayer` via DI.
That's the build error that turns the split from a convention into a
guarantee.

**3. Confirm your own project doesn't repeat the guard**

```bash
ls .eslintrc* eslint.config.* 2>/dev/null || echo "no eslint config in the simple-preset scaffold — by design"
```

The simple preset ships no eslint config. You don't need to repeat the
guard because you're not editing framework internals — your `src/models/`
classes consume the framework through public subpath imports
(`@mcp-rune/mcp-rune/models`, `@mcp-rune/mcp-rune/prompts`) that are
stable and already on the right side of the split.

**Observe:** the rule applies to mcp-rune itself and stops there. Your
project writes only declaration code (`models/` and `prompts/`); the
consumption code is the framework, behind a stable import surface. That
is the practical payoff of the split.

## The split, in code

| Declaration                                                                                                                  | Consumption                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/mcp/models/` — `BaseModel`, kinds, definitions                                                                          | `src/mcp/model-layer/`, `src/mcp/data-layer/`, `src/mcp/analysis-layer/`                                                  |
| `src/mcp/prompts/` declaration files (`base-prompt.ts`, `prompt-definitions.ts`, `prompt-content-builder.ts`, `generators/`) | `src/mcp/prompts/` consumption files (`prompt-registry.ts`, `prompt-cache.ts`, `prompt-validator.ts`, `form-strategies/`) |

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

The next chapter (and chapter 4 in detail) will show that the three consumption folders are reached only through their interfaces — `DataLayer`, `ModelLayer`, `AnalysisLayer`. Code in `apps/`, `tools/`, `prompts/`, and `data-layer/api-extensions/` is forbidden by `no-restricted-imports` from importing internal helpers from any of the consumption folders directly. The eslint guard makes the split a build error, not a guideline.

That guard is what makes the layer story _trustworthy_ downstream. Without it, "tools call DataLayer" would be a convention you could break by typo. With it, the framework knows that every projection-layer file talks only to the three layers, which is the precondition for the dependency injection covered in chapter 4.

## The same split for prompts

The model split uses sibling folders (`models/` vs `model-layer/`); the prompt split uses **file-name conventions inside one folder**, because the prompt subsystem is smaller and the eslint guard is scoped to the folder either way.

Inside `src/mcp/prompts/`:

- **Declaration side**: `base-prompt.ts`, `prompt-definitions.ts`, `prompt-content-builder.ts`, `association-transformers.ts`, `generators/`. A prompt class is purely descriptive — it declares `fieldGroups`, `sections`, a `promptContent` getter.
- **Consumption side**: `prompt-registry.ts`, `prompt-cache.ts`, `prompt-validator.ts`, `form-strategies/`. These are the runtime pieces that _consume_ a prompt class to validate input, cache derived schemas, and route through the right form strategy.

When you author a `BookPrompt`, you write it in your server's `prompts/` folder (which is to your project what `src/mcp/prompts/` is to the framework). The framework's registry, cache, and form strategies read it. You never reach back into the consumption files from inside your prompt class — the dependency only flows one way, enforced by the same `no-restricted-imports` block (`src/mcp/prompts/**` cannot import the internal helpers in `model-layer/derived-fields*`, `model-layer/validators*`, etc., or reach `ApiClient`/`ModelService` directly).

## What the next chapter assumes

You're now ready to read chapter 4 the way it's written. When that chapter says "tools call `this.dataLayer`, `this.modelLayer(name)`, and `this.analysisLayer(name)`", what it's actually saying is: tools consume the three peer interfaces in the consumption folders, while your models — and the framework's helpers that read them — stay quietly on the declaration side. The split is what makes the DI shape work.

But before we get there, chapter 3 introduces the Prompt. The Model is now fully covered as a declarative artifact; the Prompt is the first thing that _reads_ it.

## What's next

The last chapter of this section, [Derivation overview](./derivation-overview.md), is a one-page map of every framework surface that's derived from your Model declaration, with a pointer to the chapter that covers each one. Skim it before moving on, then chapter 3 picks up with the Prompt.
