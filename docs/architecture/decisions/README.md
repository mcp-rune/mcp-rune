# Architecture decision records

This folder is the durable record of mcp-rune's non-trivial architecture and AI/LLM decisions — the alternatives weighed, the trade-offs, and why one path won. A closed pull request or issue throws that reasoning away; an ADR answers the question a future maintainer actually asks: _"why is it built this way?"_

A documented **"we evaluated X and deliberately deferred it, and here is what a future implementation must honor"** is a first-class outcome here, as valuable as shipped code. Several ADRs in this folder are exactly that shape: they exist so a capability gap reads as a decision, not an omission, and so the eventual implementation starts from recorded constraints instead of re-litigating them.

## When to write one

Write an ADR when a decision shapes the framework's structure or its AI/analysis behavior and a future reader could plausibly ask "why?" or "why not?": a new seam or layer, a capability deliberately kept out of the framework, a contract that cannot be enforced mechanically, a dependency or naming strategy, a data-model commitment. Routine changes whose rationale is obvious from the diff and its PR description do not need one.

## Conventions

- One decision per file, numbered sequentially: `NNNN-kebab-case-title.md` (zero-padded, never reused).
- Statuses: `Proposed`, `Accepted`, `Accepted — implementation deferred`, `Superseded by [ADR-NNNN](...)`, `Deprecated`.
- A superseding ADR links back; the superseded ADR gets its status updated but its text is never rewritten — the record is append-only.
- Cross-reference related ADRs and epic/issue numbers so the tracker and the record stay navigable in both directions.

## Template

```markdown
# NNNN. Imperative title naming the decision

- Status: Accepted
- Date: YYYY-MM-DD
- Related: #issue, [ADR-NNNN](NNNN-...md)

## Context

What situation forced a decision, with file references where the code shapes the question.

## Decision

The chosen path, stated plainly. For deferred capabilities: the constraints any future implementation must honor.

## Options considered

Each option with its real trade-offs, including the rejected ones and why.

## Consequences

What follows — costs accepted, follow-up work promoted to the tracker, revisit triggers.
```
