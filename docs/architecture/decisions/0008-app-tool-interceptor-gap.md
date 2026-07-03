# 0008. App tools bypass the interceptor pipeline — deliberate until a real consumer appears

- Status: Accepted
- Date: 2026-07-03
- Related: #348

## Context

Tools registered through `ToolRegistry` run through a public interceptor pipeline — logging → custom interceptors → error-catch (`src/mcp/tools/interceptors.ts`, `tool-pipeline.ts`), with the composition exported for manual use. App tools registered through `AppRegistry.registerTools` do not: they get a hardcoded logging/error wrapper and no interceptor hook (`src/mcp/apps/lib/registry.ts`). "How would someone observe or intercept an app tool call?" currently has no supported answer, and a deployer discovers that only by reading source — the review flagged the undocumented asymmetry, while also noting that building the hook now would violate the project's rule against abstractions justified by symmetry alone.

## Decision

**The asymmetry is deliberate and stays until a real consumer needs otherwise.**

- No interceptor hook is added to the app-tool path now, and no second hook API grows on `ToolFlowExtensionContext`. A hook with zero consumers is inert scaffolding.
- The gap is documented where a deployer would look: the extensions guide states plainly that interceptors apply to `ToolRegistry` tools only, and that app tools carry a fixed logging/error wrapper (folds into the epic's doc-accuracy sweep, #348 task 29).
- **The sanctioned future shape is recorded now**: when a real consumer needs to intercept app tool calls, app-tool handlers are run through the _same_ `wrapToolHandler` pipeline the ToolRegistry uses — an `interceptors` option on `AppRegistry` mirroring `ToolRegistry`'s, one pipeline taxonomy for both registries. Growing a separate hook system on the tool-flow extension context is explicitly rejected as a future path, because it would fork the interceptor vocabulary the moment it exists.

## Options considered

**Unify the pipelines now — rejected.** No consumer; symmetry alone is not justification, per the project's standing rule.

**Add a wrap/observe hook to `ToolFlowExtensionContext` — rejected**, now and later. It would create a second, extension-scoped interception vocabulary parallel to the interceptor pipeline — a forked taxonomy for the same concept.

**Document the gap and pre-commit to the unification shape (chosen).** Costs a paragraph today, and removes the design debate from the future PR that actually needs the hook.

## Consequences

- Deployers learn the boundary from the guide instead of from source archaeology.
- The future implementation is a mechanical unification, not a design negotiation — this record already settles the shape.
- Anyone tempted to intercept app tools today via `getApp` + re-`registerApp` wrapping does so knowingly unsupported (and that path's silent-overwrite behavior is a separate finding on the epic, task 23).
