# 0004. Unsupervised concept discovery: deferred, structural labels over LLM labels

- Status: Accepted — implementation deferred
- Date: 2026-07-03
- Related: #348, [ADR-0001](0001-llm-synthesis-stays-client-side.md), [ADR-0007](0007-summary-strategy-determinism-contract.md)

## Context

Concepts in mcp-rune are declared: the `DomainRegistry` holds them, and the concept stratifier partitions sessions by declared-concept membership. The clustering machinery that exists — the cluster stratifier and the `semantic-cluster` summary strategy — groups records by embedding proximity but neither labels the groups nor persists them as reusable concepts. "Discover the concepts in this corpus" is a standing GraphRAG capability the framework deliberately lacks.

## Decision

Concept discovery is deferred. When built, it must honor these constraints:

- **Detection is deterministic**: seeded k-means with first-k anchor selection (the determinism device `semantic-cluster` already uses), exposed through the promised `AnalysisLayer.buildStratifier` or as a new summary strategy — inside the existing seams either way.
- **Labels are structural, not generative.** A discovered cluster is described by what the schema knows: its dominant edge types, its kind and value distributions, its representative records. Server-side LLM labeling is ruled out by [ADR-0001]; a calling LLM is free to name clusters from the structural descriptions.
- **Candidates persist as `analysis_memories` rows** (a category of the shape `concept_candidate`), recallable through the existing query path — no new table.
- **Discovered candidates are never auto-registered into `DomainRegistry`.** Declared concepts remain the single source of truth; candidates are suggestions a deployer inspects and promotes deliberately. Auto-registration would fork the concept taxonomy and launder unreviewed clusters into business vocabulary.

## Options considered

**LLM labeling server-side — rejected** ([ADR-0001]): nondeterministic, costs a key and a call per cluster, and the calling LLM can do it better with full conversational context.

**Embedding-centroid labels (nearest-text-to-centroid) — rejected as primary**: fragile and often unrepresentative; acceptable as one field inside a structural description, not as the label.

**Structural labels from schema knowledge (chosen shape)**: edge types, kinds, and distributions are exactly the information a model-driven framework has that a generic RAG stack lacks — the labels should exploit it.

## Consequences

- `DomainRegistry` stays unpolluted and singular; the promotion path (candidate → declared concept) is a human decision with an audit trail.
- The revisit trigger: a consumer whose corpus outgrows its declared concepts — e.g. concept-touch coverage reporting large untouched record populations.
