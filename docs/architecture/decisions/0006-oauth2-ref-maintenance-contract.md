# 0006. oauth2-ref is an educational reference; its parity tests guarantee signatures, not behavior

- Status: Accepted
- Date: 2026-07-03
- Related: #348

## Context

`src/oauth2-ref/` is a ~2,600-line untyped JavaScript mirror of the production `OAuthService`, documented in CONTRIBUTING.md as an educational reference implementation. It is deliberately inert in every shipping sense: excluded from the TypeScript build, absent from the published tarball and the exports map, excluded from coverage. What keeps it "in sync" is an interchangeability test suite that asserts method names and arities match the production service — nothing more. The risk the review flagged: a signature-parity suite wearing an "interchangeability" name manufactures false confidence, because the two implementations can drift arbitrarily in behavior while every test stays green.

## Decision

**Keep the reference implementation, in place, and make its guarantee honest.**

- `src/oauth2-ref/` stays where it is. Its inertness is enforced by the build/publish configuration, and its value is precisely its adjacency: it documents _this_ repo's OAuth flows in linear, dependency-light code a reader can hold next to the production service.
- The parity suite's contract is stated for what it is: **signature parity only**. Test names, suite descriptions, and the CONTRIBUTING.md section are reworded to say "interface shape" and to disclaim behavioral equivalence explicitly (folds into the epic's doc-accuracy sweep, #348 task 29).
- Behavioral drift between the reference and production is **accepted** for an artifact no traffic depends on.
- The bar for ever changing that status is recorded here: if oauth2-ref were to back real traffic or be published, it must first be typed under the project's strict TypeScript config and covered by behavioral conformance tests against the production flows. Until someone proposes that, no such work happens.

## Options considered

**Relocate to an examples repository — rejected.** The reference documents this repo's service internals; at a distance it rots faster and loses the side-by-side readability that is its whole value.

**Behavioral contract tests now — rejected.** High, ongoing cost (the flows touch PKCE, introspection, resource binding) to guarantee equivalence for an artifact whose only consumer is a human reader. The honest disclaimer buys the same safety for a fraction of the price.

**Delete it — rejected.** CONTRIBUTING.md leans on it as teaching material, and the OAuth subsystem is the framework's least-approachable code; the reference has a real audience.

**Keep + honest contract (chosen).**

## Consequences

- Nobody can mistake green parity tests for behavioral equivalence once the naming and docs say "signatures only".
- The maintenance burden stays proportional to the artifact: update signatures when the interface changes, nothing else owed.
- A future "promote oauth2-ref to a real adapter" proposal starts from this ADR's recorded bar instead of an ambiguous status quo.
