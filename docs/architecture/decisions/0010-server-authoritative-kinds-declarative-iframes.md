# 0010. Kind behavior is server-authoritative; iframes are declaratively decorated and never crash on unknown kinds

- Status: Accepted
- Date: 2026-07-03
- Related: #348, #357, [ADR-0009](0009-kinds-are-shared-vocabulary.md)

## Context

`AppRegistry({ kinds })` registers a deployer kind's behavior half with the server-side registry and forwards its `render` hint into the app iframes. The iframe bundles, however, bake the built-in `KIND_REGISTRY` at vite build time, and the CSP-safe injection channel carries only data — a deployer's `parse`/`serialize`/`toInput`/`fromInput` functions can never reach the client. Before this decision, the iframe's `getKindRenderer` delegated to the throwing `getKind`, so a documented top-level custom kind crashed list/detail cells with `UnknownKindError` and killed the form's collect/prefill paths; renderer resolution also missed `getKind`'s format-as-top-level-kind step, so hints keyed by a bare kind silently never applied to `format:`-carrying attributes. The boot-time guard (`validateRegistries`) cannot help here: it validates against the server registry, which is exactly the registry the iframe does not have.

## Decision

**The server is authoritative for kind behavior; iframes are declaratively decorated, and unknown kinds degrade instead of crashing.**

1. `getKindRenderer` never throws. An unknown kind resolves to string semantics (raw display, passthrough input handling) with a one-time console warning naming the kind and both remedies. Every iframe consumption path — cell rendering, form collect, form prefill — funnels through it, so one fallback covers them all. The server-side `getKind` keeps throwing loudly; only the baked-registry context degrades.
2. **Display crosses declaratively.** `render` hints remain the one channel for custom display in the iframe, including for kinds whose descriptors the bundle has never seen — hint resolution works independently of descriptor resolution.
3. **Renderer resolution mirrors `getKind`'s three steps** (`kind:format` → `format` as top-level → bare `kind`), so hints keyed either way apply consistently.
4. **`kind:format` narrowing is the documented path** when form inputs should inherit a built-in's handling: the server applies the narrowed descriptor end-to-end; the iframe falls back to the base kind's baked descriptor. Top-level custom kinds stay fully supported server-side, with string-semantics degradation as their iframe floor.

## Options considered

**Serialize descriptor functions into the iframe — rejected.** Shipping deployer function bodies through the resource channel means executing arbitrary strings in the iframe, which the CSP-safe design exists to prevent; it would also fork the descriptor into two live copies that drift.

**Mirror serializable descriptor scalars (label, htmlInputType) into the iframe — rejected for now.** The iframe receives the resolved form schema from the server, which already carries the input type and options per field — the scalars would duplicate information the schema already delivers, for no observed consumer.

**Grow the declarative hint vocabulary into a value-transform DSL — deferred.** A closed allowlist of transforms (currency/locale formatting beyond `template`/`dateStyle`, numeric rounding) could narrow the display gap for top-level custom kinds without executing deployer code. That is real design surface with no consumer demanding it yet; if one appears, extend `KindRenderHint` — never a function channel.

**Fail loudly in the iframe (status quo) — rejected.** The throw punishes the documented usage pattern with a crashed UI in a context where the boot validator structurally cannot intervene. Loud-at-boot, graceful-at-render is the right split of the two guarantees.

## Consequences

- The docs' `currency` worked example is now honest about where each half runs, and recommends `kind:format` narrowing when input semantics matter in the form.
- A deployer who forgets a render hint gets a functional app with raw-string display and a console pointer, not a support incident.
- The one-time warning is the observability hook: it names the kind and both remedies (render hint, `kind:format`).
- If the hint vocabulary ever grows (deferred option), it extends `KindRenderHint` behind the same injection channel — the no-functions rule is permanent.
