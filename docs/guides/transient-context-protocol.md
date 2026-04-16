# Transient Context Protocol

Server-to-client protocol for managing conversation context growth during workflow loops. Data-fetching tools mark their responses as transient; consumer tools signal consumption; the MCP client collapses consumed results to compact summaries.

## Problem

During fetch-analyze workflow loops, each page of fetched data stays in the conversation context even after analysis has been stored server-side. Over 7+ loop iterations, the conversation bloats with raw data that the LLM no longer needs.

## Relationship to Lean Mode

These are **complementary**, not competing:

| Pattern               | LLM sees data?   | Use case                                               |
| --------------------- | ---------------- | ------------------------------------------------------ |
| **Lean mode**         | No               | LLM doesn't need data (counting, passing scratch_refs) |
| **Transient context** | Yes, temporarily | LLM needs data for analysis, then client collapses it  |

Lean mode stores data server-side and returns only a summary. Transient context sends full data to the LLM but signals the client to collapse it after a consumer tool processes it.

## Protocol Overview

```
get_workflow_step → _meta.contextHints (registers transient/consumer pairs)
       ↓
search_records   → _meta.context.lifecycle: 'transient' + summary
       ↓
LLM analyzes the data
       ↓
store_analysis_memory → _meta.context.consumed: true
       ↓
Client collapses the search_records result → replaces with summary
```

## Server-Side: `_meta.context` on Tool Responses

### Data-fetching tools (`search_records`, `find_model`)

When returning 5+ records, attach `_meta.context`:

```json
{
  "content": [{ "type": "text", "text": "...full data..." }],
  "_meta": {
    "context": {
      "lifecycle": "transient",
      "summary": "15 activity records (page 1/9, IDs: 72, 73, 74…)"
    }
  }
}
```

- **`lifecycle: 'transient'`** — marks this result as collapsible after consumption
- **`summary`** — compact replacement text the client displays after collapse
- No `consumedBy` field — the client learns the consumer from the workflow step's `contextHint`

### Consumer tools (`store_analysis_memory`)

Signal consumption:

```json
{
  "content": [{ "type": "text", "text": "Stored analysis finding..." }],
  "_meta": {
    "context": {
      "consumed": true
    }
  }
}
```

The `consumed: true` flag tells the client to collapse the most recent uncollapsed transient result from the paired data-fetching tool.

## Server-Side: `contextHint` on Workflow Steps

Workflow steps declare the transient/consumer relationship via `contextHint`:

```javascript
{
  order: 2,
  title: 'Fetch activities',
  tool: 'search_records',
  loopGroup: 'fetch-analyze',
  contextHint: {
    lifecycle: 'transient',
    consumedBy: 'store_analysis_memory'
  }
}
```

This is exposed to the client via `get_workflow_step`'s `_meta.contextHints`:

```json
{
  "content": [{ "type": "text", "text": "## Steps 2–3 — loop..." }],
  "_meta": {
    "contextHints": [
      {
        "step": 2,
        "tool": "search_records",
        "lifecycle": "transient",
        "consumedBy": "store_analysis_memory"
      }
    ]
  }
}
```

### Design rationale

- **Tools stay generic** — `search_records` doesn't know about `store_analysis_memory`
- **Workflow steps own the relationship** — the `contextHint` declares which tool consumes this step's output
- **Works outside workflows** — the `lifecycle: 'transient'` hint on tool responses is self-contained; the `contextHint` just adds consumer scoping

## Client-Side: COC-pro Collapse Protocol

### Step A: Register relationships

When `get_workflow_step` returns `_meta.contextHints`, register the transient/consumer pairs:

```
contextHints → Map<consumedBy, tool>
  e.g., store_analysis_memory → search_records
```

### Step B: Track transient results

When a tool result arrives with `_meta.context.lifecycle === 'transient'`:

1. Check if the tool name matches a registered transient tool
2. Store the message index and `summary` text
3. Display the full result normally — the LLM needs it for analysis

### Step C: Collapse on consumption

When a tool result arrives with `_meta.context.consumed === true`:

1. Check if the tool name matches a registered `consumedBy`
2. Find the most recent uncollapsed transient message for the paired tool
3. Replace that message's `content` with the stored `summary` text
4. The collapsed content is **not** sent to the LLM in subsequent turns
5. In UI: show as a gray expandable accordion — user can click to inspect original data

### Edge cases

- If the consumer tool fails (`isError`), do **not** collapse — the LLM may retry
- If multiple transient results are pending, collapse the oldest matching
- If the user expands a collapsed message, show original content read-only

## Client-Side: Display Settings

**Settings > General > Display > Show context hints** (default: off)

When enabled, display debug badges on tool results:

- **`[transient]`** (amber) — result will be collapsed after consumption
- **`[consumed]`** (green) — this tool triggered a collapse
- **`[collapsed]`** (gray) — result has been collapsed, shows summary

## Example: Reclassify Workflow

```
[get_workflow_step] → _meta.contextHints: search_records transient, consumed by store_analysis_memory

[search_records page 1] → 15 activities (full data)                   [transient]
[store_analysis_memory] → "Stored finding: 3 activities to Web Dev"   [consumed]
  ↓ Client collapses search_records result
[collapsed] "15 activity records (page 1/9, IDs: 72, 73, 74…)"       [collapsed]

[search_records page 2] → 15 activities (full data)                   [transient]
[store_analysis_memory] → "Stored finding: 5 activities to AI"        [consumed]
  ↓ Client collapses search_records result
[collapsed] "15 activity records (page 2/9, IDs: 87, 88, 89…)"       [collapsed]

... (repeats for all pages)
```

After the loop, the conversation contains only compact summaries + analysis findings, not 132 raw activity records.
