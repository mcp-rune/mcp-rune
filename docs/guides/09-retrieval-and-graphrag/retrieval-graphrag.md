# Retrieval & GraphRAG

The architectural map for chapter IX. If you'd like to feel this working before reading the architecture, run [Analysis quickstart](./analysis-quickstart.md) first — it brings up pgvector and walks every summary strategy end to end against fixtures. Come back here when you want to know which piece does what.

mcp-rune doesn't just hand an agent raw rows — it indexes a whole dataset three ways and lets the agent answer by _meaning_, _aggregate_, or _stratified sample_. Vectors give you semantic recall; a relationship graph and a domain registry make that recall **GraphRAG-aware**.

This guide frames how they fit together and which guide owns which piece.

```
RETRIEVAL / GRAPHRAG PIPELINE                      MiniLM-L6-v2 · 384-dim · pgvector

  ① INGEST              ② INDEX (GraphRAG)        ③ QUERY                ④ ANSWER
  ----------            ------------------        -------                --------
  your API        ┌──>  vectors                   analysis_query         findings[]
  GET /api/<m>    │     analysis_memories          · describe   ┐         stored &
  analysis_ingest │     MiniLM · 384-dim           · aggregate  │ SQL     recallable
  paginate ≤ 50   ├──>  edges                      · filter     │           │
                  │     multi-hop ingest           · sample     ┘           ▼
                  │     relationship graph          · semantic  → cosine   the answer
                  ├──>  domain                      9 summary strategies   synthesised
                  │     DomainRegistry              5 field-level          0 raw rows
                  │     concepts · rules            4 GraphRAG-aware       in context
                  └──>  ingested_records (raw JSONB · 1h TTL)
```

## Three indexes, one ingest

A single `analysis_ingest` call auto-paginates an API model into offline storage (up to 50 pages), and — depending on how it's invoked — populates up to three indexes over the same records:

| Index | What it stores | Lit up by | Deep dive |
| --- | --- | --- | --- |
| **Vectors** | every page summary + stored finding, embedded with `all-MiniLM-L6-v2` (384-dim) in local **pgvector** | always | [Analysis Memories](./analysis-memories.md) |
| **Edges** | relationships between records, followed across models | multi-hop ingest | [Analysis Memories](./analysis-memories.md) |
| **Domain** | concepts + business rules that ground findings in your vocabulary | a `DomainRegistry` passed at boot | [Domain Knowledge](../08-domain-knowledge/domain-knowledge.md) |

The raw rows land in an `ingested_records` table (plain JSONB, 1-hour TTL) that the SQL query modes read directly. **Raw rows never cross the context window** — the agent works from summaries and findings.

## Five query modes

`analysis_query` answers in five modes. Four are deterministic SQL over `ingested_records`; one is vector recall over the embedded memories:

- **describe** — shape of the data: counts, numeric stats, date ranges.
- **aggregate** — `GROUP BY` over fields.
- **filter** — JSONB predicates (`@>`, range casts).
- **sample** — random or **stratified** samples (incl. proximity buckets).
- **semantic** — embeds the _query string_ and ranks memories by cosine distance.

Only `semantic` pays for an embed (of the query, not the data). The rest are cheap, deterministic SQL.

## Nine summary strategies

Every ingested page gets a **page summary** — the agent's semantic "starter pack," searchable before it has written anything. A _summary strategy_ decides what that summary contains. The nine built-ins split by what auxiliary data they need:

- **Field-level (5)** — work on records alone: `distribution`, `coverage`, `anomaly`, `temporal`, `entity-extraction`.
- **GraphRAG-aware (4)** — need an auxiliary index:
  - `relationship-coverage` — requires **edges**
  - `concept-touch` — requires **edges + domain**
  - `rule-violation` — requires **domain**
  - `semantic-cluster` — requires **embeddings**

The dispatcher loads each strategy's requirements lazily and silently skips any whose inputs aren't present. See [Summary Strategies](./summary-strategies.md).

## Proximity sampling

When an investigation is anchored to a date ("show me representative records around March 15th"), `sample` mode takes a `proximity` window and date buckets so the sample spreads evenly across time instead of clustering on the densest day. See [Proximity Sampling](./proximity-sampling.md).

## The six tools

The LLM drives the loop; the framework provides the seams:

| Tool                 | Role                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `analysis_ingest`    | download once, build the indexes                                   |
| `analysis_query`     | read — describe / aggregate / filter / sample / semantic           |
| `analysis_store`     | commit a finding (embedded, recallable)                            |
| `analysis_summarize` | re-summarize a page without re-fetching                            |
| `analysis_act`       | mutate a filtered subset server-side — IDs never return to context |
| `analysis_clear`     | tear down the analysis_id                                          |

## Enable it

Retrieval is opt-in. Set `ANALYSIS_ENABLED=true` and provide a Postgres database with the `pgvector` extension; embeddings run **locally** via MiniLM — no external vector database and no embedding API. The [Analysis Quickstart](./analysis-quickstart.md) brings pgvector up and walks every strategy end to end against a 5,000-record dataset.

## Where to go next

- **[Analysis Memories](./analysis-memories.md)** — the full six-tool feature, the data-flow, lifecycle and retention.
- **[Summary Strategies](./summary-strategies.md)** — the nine strategies and how to author your own.
- **[Proximity Sampling](./proximity-sampling.md)** — date-windowed, bucket-stratified sampling.
- **[Domain Knowledge](../08-domain-knowledge/domain-knowledge.md)** — the concepts and rules that ground GraphRAG-aware strategies.
- **[Analysis Quickstart](./analysis-quickstart.md)** — hands-on, end to end.
