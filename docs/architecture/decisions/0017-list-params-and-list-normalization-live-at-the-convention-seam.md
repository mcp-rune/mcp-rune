# 0017. List params and list normalization live at the convention seam

- Status: Accepted
- Date: 2026-07-03
- Related: #348, [ADR-0014](0014-seam-error-taxonomy.md)

## Context

The `BaseConvention` seam owns wire-format translation in both directions — request payloads (`buildRequestPayload`), response extraction (`normalizeListResponse`), error parsing (`parseErrorResponse`). But list **pagination** leaked past it. `ModelService.list` hardcoded `{ page, per_page }` into the query params, so a backend that paginates as JSON:API `page[number]` / `page[size]` (or any nested scheme) could not be served — the one shape a convention could not customize, despite pagination being pure wire format.

Symmetrically, the search extension's `_extractRecords` / `_extractPagination` guessed the response envelope from a ladder of `if (response.data)` / `if (response._embedded)` / model-keyed-array heuristics instead of asking the model's convention, which already knows its own envelope via `normalizeListResponse`. So a model that declared a convention still had its search results shaped by guesswork.

## Decision

**Move both sides of list handling to the convention seam.**

- New `BaseConvention.serializeListParams({ page, perPage, filters })` returns the wire query params. The base implementation emits flat `{ ...filters, page, per_page }` — the current behavior — so nothing changes for existing conventions. A convention whose backend paginates differently overrides it (the ADR ships with a JSON:API example in the guide and a test). `ModelService.list` calls it instead of building the object inline.
- The search extension's `_normalizeResponse` accepts the model's convention and delegates to `normalizeListResponse` when the model **explicitly declares one**. A model with no declared convention keeps the best-effort format guessing, which recognizes more envelope shapes (HAL `_embedded`, model-keyed arrays) than a bare default convention — so this is additive, not a behavior change for existing models.

## Options considered

**Add a `paginationStyle: 'flat' | 'json-api'` enum on the model — rejected.** It enumerates the two styles we happen to know and forces a new enum member for every backend variation. A method override expresses any scheme (Ransack `q[...]`, cursor tokens, offset/limit) without the framework predicting them.

**Delegate search normalization to the convention unconditionally — rejected.** The guessing extractors handle envelope shapes (HAL, model-keyed) that a minimal `normalizeListResponse` does not; routing every model through the default convention regressed those. Gating delegation on an _explicitly declared_ convention keeps the flexible fallback for models that never opted in.

**Leave pagination hardcoded, document the limitation — rejected.** "This framework can talk to any REST backend except ones that paginate like JSON:API" is not a seam; it is a gap the seam exists to close.

## Consequences

- JSON:API / nested-pagination backends are now serviceable by overriding one method; no `ModelService` change required per deployer.
- Pagination and list-envelope handling are both testable at the convention, where the other wire-format concerns already live.
- Non-breaking: the base `serializeListParams` reproduces the old flat params, and search normalization only changes for models that explicitly declare a convention.
