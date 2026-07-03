# 0009. Kinds are shared vocabulary, not a ModelLayer method

- Status: Accepted
- Date: 2026-07-03
- Related: #348, #355

## Context

Two seam files contradicted each other about who may read kind descriptors: `model-layer.ts` forbade projection code from importing `getKind` directly and offered `modelLayer(name).kindFor(attrName)` instead, while `kinds/index.ts` blessed `prompts/` and `apps/` as downstream readers of `getKind(name, format)`. Reality had already voted: every projection call site used `getKind` directly, and `kindFor` — along with `validFieldNames`, `promptSchema`, and `checkRequired` — had zero consumers in the framework and zero non-comment call sites in both downstream forks. Meanwhile the kinds contract ("single source of truth for validate / HTML-input per type") was factually broken: enum membership lived inline in the form strategy, select/checkbox input widening lived inline in the form-schema builder, `KindOpts.enumValues` was read by no kind, and `rating`'s `max` had no server-side path, so a >5-point scale rendered correctly in the DOM and then failed server validation. Compounding this, `AttributeDefinition.type` was a closed 7-literal union while the runtime registry held 17 built-ins and accepts deployer extensions — a compile error for `type: 'date'` that the boot validator, the runtime, and the error messages all considered valid.

## Decision

**Kinds are shared vocabulary.** Projection code reads descriptors directly from `src/mcp/models/kinds/`: `getKind(type, format)` for the descriptor, `kindOptsFrom(definition)` for the definition-level knobs, `resolveInputType(type, format, opts)` for input widening. The lint guard does not restrict kinds imports — they are declaration-side, boot-static, and pure, like the `model-definitions` types.

What makes the vocabulary honest:

- **The registry owns `enumValues` membership.** `registerKind` wraps every descriptor's `validate` — built-in or deployer-supplied — so a value is checked against `opts.enumValues` before the kind's own rules run. No kind file, form strategy, or schema builder implements membership again.
- **Input widening has one home.** `resolveInputType` encodes "enumValues ⇒ select (checkbox_group for array)"; the form-schema builder calls it instead of encoding the rule inline.
- **Definition knobs travel through one extractor.** `kindOptsFrom` is the only place that knows which definition fields (`format`, `enumValues`, `max`) become `KindOpts`; `max` is now typed on `AttributeDefinition` and `PromptFieldDefinition` and copied by schema derivation, so `rating` bounds hold end-to-end.
- **The type union is open.** `AttributeDefinition.type` is `KnownKind | (string & {})` — completion for the built-ins without closing the extensible registry; `validateRegistries` at boot remains the enforcement point.

**ModelLayer shrinks to its real consumer surface**: `resolveDerivedFields` (three call sites). `kindFor`, `validFieldNames`, `promptSchema`, and `checkRequired` are deleted — per the project rule, an abstraction with no consumer does not get to exist on a seam.

## Options considered

**Kinds behind the layer (`kindFor` et al.) — rejected.** Per-model binding structurally cannot serve the biggest kind consumers: prompt form strategies validate prompt-only fields that no model declares, so `kindFor(attrName)` throws exactly where kind lookups are needed most. Serving them would have required a second, unbound lookup surface beside the bound one — two paths to the same registry, which is the parallel-taxonomy shape the project bans.

**Bound-descriptor accessor (keep `kindFor`, add opts threading) — rejected.** Every candidate consumer already holds the definition object (form strategies hold `PromptFieldDefinition`s, the schema builder holds `AttributeDefinition`s), so a name-keyed accessor adds a lookup hop without removing any code; `kindOptsFrom` over the definition in hand is strictly simpler.

**Status quo (contradictory docstrings, inert methods) — rejected.** Four speculative methods on a seam teach readers a consumption path that nothing uses, and the contradiction meant neither rule was enforceable.

## Consequences

- The lint guard restricts `model-layer/*` internals only; kinds imports from projection code are sanctioned and documented at both seam files.
- Deleting the four methods is BREAKING on the `ModelLayer` interface (pre-1.0, forks verified clean).
- A future genuine layer read (one with a named consumer) extends the interface as before — the bar is a real consumer, recorded in the guide's contributor section.
- Deployer-registered kinds inherit membership enforcement automatically; their descriptors cannot forget it.
