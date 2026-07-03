# 0005. Keep the runtime observability facades; rename the folder that mislabels them

- Status: Accepted
- Date: 2026-07-03
- Related: #348

## Context

`src/runtime/vendor/{langfuse,sentry,pgvector}` (the folder this decision renames to `integrations/`) are not vendored code. The langfuse and sentry modules are thin facades over live npm dependencies (`@langfuse/otel`, `@sentry/node`); pgvector is first-party SQL adapter code. Each facade carries a "change this import to switch vendors" comment (`src/runtime/tracing.ts`, `src/runtime/error-tracking.ts`) with exactly one implementation behind it — which reads as an abstraction justified by symmetry alone, and the folder name actively implies copied third-party source that would carry version-drift risk. The review also found the vitest coverage exclude for the sentry module pointing at a path that no longer exists (`src/services/vendor/sentry/index.ts`), stale rot the misleading layout helped hide.

## Decision

**Keep the facades. Rename the folder.**

The facades earn their keep on three concrete grounds, which is what distinguishes them from symmetry-only indirection:

1. **Sanitizer injection** — the shared redaction in `src/runtime/sanitizers.ts` is wired through the facade (e.g. Sentry's `beforeSend`); collapsing the facade scatters redaction into call sites.
2. **Graceful disable** — when no key/DSN is configured, the facade turns the subsystem into a no-op instead of a crash; that behavior needs one owner.
3. **API stability** — OpenTelemetry and Langfuse ship 0.x/major churn; the facade keeps the framework-internal surface (`traceToolCall`, `flushTracing`, …) stable underneath it.

The folder is renamed `src/runtime/vendor/` → `src/runtime/integrations/`, so the name says what the code is: integration adapters over external services, plus the first-party pgvector adapter. The "switch vendors by changing this import" comments are rewritten to describe the facade's actual jobs (the three above) instead of a hypothetical second vendor.

## Options considered

**Collapse the indirection — rejected.** Loses the sanitizer seam and the disabled-mode behavior, which are real consumers of the facade; the abstraction is not symmetry-only once those are counted.

**Keep the `vendor/` name and document it — rejected.** A comment cannot outshout a folder name; every future reader pattern-matches `vendor/` to copied source and re-derives the same confusion this ADR exists to end.

**Genuinely support a second backend per facade before keeping the seam — rejected.** That is inert scaffolding: building a second tracing backend nobody asked for, to justify a seam that already has three real jobs.

**Rename to `integrations/` (chosen).** Mechanical, honest, and the cheapest end to the recurring misreading.

## Consequences

- One mechanical PR, promoted to the epic checklist: move the folder, update internal imports, fix the stale coverage exclude (correcting its path in the same change), and sweep doc references.
- No public-API impact: the modules are internal; the `runtime` subpath's exported surface is unchanged.
