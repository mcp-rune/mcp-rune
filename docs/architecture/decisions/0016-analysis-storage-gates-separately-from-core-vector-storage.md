# 0016. Analysis storage gates separately from core vector storage

- Status: Accepted
- Date: 2026-07-03
- Related: #348, [ADR-0013](0013-sessions-are-graphs-analyses-are-per-model.md)

## Context

Two distinct pgvector-backed features shared one registration gate. The **core** feature is `tool_memories` — semantic operation memory the operations tool family (`find_similar_operations`, `detect_operation_gaps`, `cluster_operations`) queries. The **analysis** feature is the heavier `analysis_memories` / `ingested_records` / `ingested_edges` substrate the six `analysis_*` tools drive. The database migrations already tag these `core` vs `analysis`, but both the operations and analysis tool families set the same `static requiresVectorStorage = true`, and `ToolRegistry` gated both on the single `vectorStorageEnabled` flag.

The consequence: a deployment that wanted operation memory (`vectorStorageEnabled: true`) got all six analysis tools whether or not it ran the analysis migrations — the exact coupling the migration split was designed to avoid. The `ANALYSIS_ENABLED` name existed only in comments and downstream scaffold conventions; nothing in the framework read it, so there was no framework-level way to ship core memory without the analysis surface.

## Decision

**Split the gate along the same seam the migrations already use.**

- New `static requiresAnalysisStorage` flag on `BaseTool` (default `false`). `BaseAnalysisTool` sets it and no longer sets `requiresVectorStorage`; `BaseOperationsTool` keeps `requiresVectorStorage` for the `tool_memories` core feature.
- New `analysisStorageEnabled` option on `ToolRegistryConfig`, gating `requiresAnalysisStorage` tools independently of `vectorStorageEnabled`. The two flags compose: a deployment can enable either, both, or neither.
- The `ToolClass` structural interface gains `requiresAnalysisStorage`, so the gate is part of the tool contract, not a duck-typed read.

## Options considered

**Keep one flag, document the coupling — rejected.** The coupling is the bug: "enable operation memory" silently meaning "also ship six analysis tools" is a surprise no comment removes. The migrations already pay for the core/analysis distinction; the registration gate should honor it.

**Read `ANALYSIS_ENABLED` from the environment — rejected.** The framework injects its Postgres pool and registries explicitly (ADR-adjacent to the pool-injection design); reading `process.env` inside the registry would reintroduce the hidden-global coupling the rest of the framework avoids. `analysisStorageEnabled` stays an explicit config value the deployer computes however they like (including from their own `ANALYSIS_ENABLED` convention).

**Require both flags for analysis tools (`vectorStorageEnabled && analysisStorageEnabled`) — rejected.** It re-couples the two; an analysis-only deployment would have to enable the core flag it doesn't use. The analysis tables carry their own embeddings, so analysis storage stands alone.

## Consequences

- BREAKING: analysis tools now register only when `analysisStorageEnabled: true`. A deployment that relied on `vectorStorageEnabled` to surface analysis tools must add `analysisStorageEnabled: true`. Downstream forks reimplement the registry and gate on `requiresVectorStorage`; they must adopt `requiresAnalysisStorage` to keep gating analysis tools.
- A core-memory-only deployment no longer ships the analysis tool family.
- The registry gate now mirrors the migration feature tags one-to-one, so "which migrations do I run" and "which tools register" answer to the same core/analysis split.
- The scaffold's `ANALYSIS_ENABLED` convention maps cleanly: it drives both `analysisStorageEnabled` and whether the analysis migrations run.
