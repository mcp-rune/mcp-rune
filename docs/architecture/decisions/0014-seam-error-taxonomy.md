# 0014. Backend failures cross the DataLayer seam as a typed taxonomy, translated by the adapter

- Status: Accepted
- Date: 2026-07-03
- Related: #348, #369, [ADR-0011](0011-search-config-is-registry-level.md)

## Context

The seam file promised "throws domain errors; tools catch and format for MCP" but delivered raw transport errors. `ModelService` passed `ApiClient` rejections through untranslated; `BaseTool.formatError` duck-typed an axios-shaped `error.response.{status,data}` that no contract declared; two more tools carried private copies of the same duck-typing; the in-memory stub threw plain `Error`s — so projection code could not distinguish not-found from server error across adapters. Worst, error bodies were parsed with the server-wide `defaultConvention` instead of the failing model's `api.convention` — the one place where "per-model convention always wins" was not honored, and the parsing happened at the consumer instead of the boundary that knows the model.

## Decision

**Backend failures cross the seam as a typed taxonomy, translated exactly once, at the adapter boundary, with the failing model's convention.**

- `src/mcp/data-layer/errors.ts` (re-exported from the seam file and the public subpath): `DataLayerError` base carrying `model`, `RecordNotFoundError` (`model` + `recordId`), and `ApiRequestError` (`status` + `messages` already parsed through the model's convention). The original rejection rides along as `cause`.
- `ModelService` wraps every `ApiClient` call in one translation point (`_call` → `translateApiError`): a record-scoped 404 becomes `RecordNotFoundError`; any other HTTP failure becomes `ApiRequestError` with the body parsed by `modelConfig.api.convention ?? defaultConvention`; rejections without a `response` (network failures, timeouts) pass through untouched. `dispatch` translates with the default convention — it has no model.
- **The `ApiClient` throw shape is a declared contract** (`ApiClientHttpError` in `src/core/api-client.ts`) instead of an implicit axios assumption scattered across consumers. Implementations that reject differently forfeit typed errors, visibly.
- `BaseTool.formatError` renders `error.message` and logs the taxonomy `status`; its convention-parsing path — the wrong-convention one — is deleted, along with every private `HttpError` duck-type in tools.
- The in-memory stub throws `RecordNotFoundError`, so adapter-swapped tests exercise the same error contract as production.

## Options considered

**Documented duck-typed `response` contract (no classes) — rejected.** It fixes the undeclared-shape problem but leaves parsing at every consumer, keeps the wrong-convention bug structurally available, and gives projection code nothing to `instanceof` on for not-found handling.

**Convention-owned translation hook (`convention.toError(response)`) — rejected for now.** Conventions already own body parsing (`parseErrorResponse`), which the taxonomy composes; letting each convention also choose error _classes_ would fork the taxonomy per wire format. If a backend ever needs custom error classes, the extension point is a new adapter, not a convention hook.

**Translating in `BaseTool` (keep adapter raw) — rejected.** The tool layer does not know which model failed on nested/search paths, and apps and prompts would each need the same translation again. The adapter is the boundary that has the model, the convention, and the transport error in one place.

## Consequences

- BREAKING: error classes and message formats reaching projection code change (`Record not found: book/999` → `No book found with id "999"`); consumers that duck-typed `error.response` must read `ApiRequestError.status`/`messages`.
- Task 3's guard extension gains its natural home: `MissingRequiredFieldsError` migrates into `errors.ts` when the data-layer lint gate lands.
- Custom `DataLayer` adapters have a taxonomy to throw — the stub demonstrates the minimum contract.
- Error-parsing behavior is tested where it lives: `translateApiError` unit tests carry the convention scenarios; `formatError` tests only rendering.
