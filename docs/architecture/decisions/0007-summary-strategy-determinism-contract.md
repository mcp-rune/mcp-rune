# 0007. Summary-strategy determinism is a documented contract with a CI probe, not a sandbox

- Status: Accepted
- Date: 2026-07-03
- Related: #348, [ADR-0001](0001-llm-synthesis-stays-client-side.md), [ADR-0002](0002-deterministic-community-summarization.md)

## Context

The summary-strategy contract (`src/mcp/analysis-layer/summary-strategies/types.ts`) states that `generate` never calls the network, an LLM, or any I/O — determinism is what makes analysis results reproducible and the whole client-side-synthesis stance ([ADR-0001]) coherent. But the contract is structurally unenforceable: `generate` may be async, the `rule-violation` strategy awaits host-provided `rule.evaluate` functions that are typed to allow Promises, and host extensions can register arbitrary strategies through the `ApiExtension` collector. JavaScript offers no sandbox that could mechanically forbid I/O inside a strategy, so "enforce over convention" cannot be satisfied literally — the question is where enforcement honestly stops.

## Decision

Determinism is a **documented contract at the registration seam, backed by a CI probe for everything the framework ships**:

- **Built-in strategies are guaranteed deterministic**, and CI proves it: a double-invoke-and-compare test runs every built-in strategy twice over a fixture corpus and asserts byte-identical output. A strategy that sneaks in wall-clock time, randomness, or iteration-order sensitivity fails the build. This probe is promoted to the epic checklist (#348).
- **Host-registered strategies get the contract, stated where they register**: the JSDoc at the summary-strategy registration seam and the ApiExtension authoring guide state the no-I/O/no-LLM/deterministic requirements and that violations are the host's responsibility — the framework does not police them at runtime.
- **No runtime double-invocation.** The framework will not run strategies twice in production to detect nondeterminism.

## Options considered

**Runtime sandboxing — impossible.** JavaScript provides no practical mechanism to forbid I/O inside an arbitrary host function without a process boundary, and a process boundary per strategy invocation is absurd for this workload.

**Runtime double-invoke-and-compare — rejected.** Doubles the cost of every summarized page in production to catch a bug class that CI can catch once, at build time, for the code the framework actually controls.

**Documented contract + CI probe for built-ins (chosen).** Mechanical enforcement exactly as far as the framework's ownership extends; honest documentation beyond it.

## Consequences

- The determinism guarantee in docs gets a precise scope: framework-shipped strategies are proven deterministic; host strategies are contractually required to be.
- The CI probe doubles as a regression net for future built-ins ([ADR-0002]'s community summaries, [ADR-0004]'s discovery strategy, if promoted).
- `rule-violation`'s dependence on host `rule.evaluate` keeps working, with responsibility for its determinism resting where the rule is written.
