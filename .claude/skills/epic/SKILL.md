---
name: epic
description: Invoke when the developer explicitly asks to turn the current conversation into a GitHub epic (e.g. via `/epic`, "open an epic for this", "create an epic issue and sub-issues for these findings"). Bundles everything gathered in the thread into ONE epic issue, then opens one focused sub-issue per concrete change, each linked back to the epic. Do NOT auto-fire on review/audit/refactor keywords — only when the user explicitly asks to file the epic.
---

# Epic

The "epic workflow" is already defined in `AGENTS.md` (search for `## Epic workflow for complex changes`): one parent issue enumerates every concrete sub-change; sub-issues are opened and shipped one at a time, each closed by its own PR; the epic stays open as the source of truth and is closed with a summary table when the last sub-PR lands.

This skill automates the **opening** step: take whatever the current conversation has converged on — a code review, a design exploration, an audit — and file the epic + its sub-issues against `mcp-rune/mcp-rune`.

## When to invoke

Only on explicit `/epic` or equivalent ask. The conversation must already contain a _concrete, enumerated list of changes_ — duplicated interfaces to remove, files to split, names to rename, etc. If the thread is still exploratory ("what could we do about X?"), refuse and ask the user to converge on a list first. An epic with vague bullets is worse than no epic.

## Default mode: epic-only, sub-issues on demand

**File the epic only.** Do NOT file sub-issues up front. The epic body must enumerate every axis in enough detail that any one of them can become a sub-issue later without going back to the conversation: per-axis problem, file:line refs, proposed change, BREAKING flag, target labels.

Sub-issues get opened one at a time, only when the user decides to implement that specific axis. This avoids label/scope rework when an axis's direction is still being settled, and keeps the issue tracker clean of "planned but maybe never" tickets.

The "file all sub-issues now" variant is only correct when the user explicitly asks for it — they've already settled every axis and want a complete checklist immediately.

## Workflow

### 1. Extract the list from the conversation

Re-read the thread and produce a structured list:

- **Title** for the epic — one short imperative phrase describing the overall effort ("Resolve duplicated/misplaced interface declarations across src/").
- **Context** — 3-6 sentences on what was discovered, why it matters, and what scope the epic covers. Quote concrete numbers from the conversation (file counts, import counts, duplicate counts) when they exist.
- **Sub-items**, one per intended sub-PR. Each sub-item is:
  - A focused imperative title (`Resolve FilterSchema name collision (base-tool vs validators)`).
  - 1-3 bullets of detail: what's wrong now, what the fix looks like, file paths with `:line` anchors.
  - A `BREAKING:` flag if the change touches public API (likely for this project).
  - The right labels from the existing taxonomy.

If two findings touch the same file and would obviously ship as one PR, bundle them into one sub-item — the epic workflow already allows "per natural bundle of axes that touches the same files."

### 2. Pick labels

Use the existing taxonomy (run `unset GITHUB_TOKEN; gh label list --repo mcp-rune/mcp-rune --limit 200` to refresh). Default scoped labels per area:

- `core:models` — anything touching `ModelConfig` / `ModelsRegistry` / `BaseModel` / model definitions.
- `mcp:tools` — anything in `src/mcp/tools/` (`base-tool.ts`, validators, registries).
- `mcp:apps` — anything in `src/mcp/apps/`.
- `mcp:storage` — `src/runtime/vector-storage.ts` and `src/runtime/vendor/pgvector/`.
- `mcp:analysis` / `mcp:operations` / `mcp:search` / `mcp:services` — sibling categories.
- `api:conventions` — `src/mcp/data-layer/api-conventions/` etc.
- `lib:oauth2`, `server:http`, `server:logging`, `infra:typescript`, `infra:ci`, `dx:testing`, `dx:build`, `dx:lint` — as applicable.

Add `breaking` if it changes public exports (renamed/deleted types, moved exports). For BREAKING-changes-phase mcp-rune this is the common case.

**Do not add `area:*` / `status:*` labels by default** — those are Roadmap-only. The `roadmap` skill governs them, and it's opt-in. Only add them if the user explicitly invokes `/roadmap` afterward or asks for Roadmap inclusion.

Create an `epic` label on demand if it doesn't exist yet (color `#5319E7`, description `Parent issue tracking a coordinated multi-PR effort.`):

```sh
unset GITHUB_TOKEN
gh label create epic --repo mcp-rune/mcp-rune --color 5319E7 \
  --description "Parent issue tracking a coordinated multi-PR effort." 2>/dev/null || true
```

Apply `epic` to the parent issue only — not to the sub-issues.

### 3. Confirm before filing

Show the user the proposed epic title, the proposed sub-item titles (numbered), and the label mapping. Ask for confirmation with `AskUserQuestion`. Filing 5+ issues is a hard-to-reverse action; never skip this step. Even in Auto Mode, this confirmation is the explicit instruction overriding the bias toward action.

If the user redirects ("drop item 3", "merge 1 and 2", "rename item 5"), apply the redirect and re-confirm only the changed pieces.

### 4. File the epic

Always shell out with `unset GITHUB_TOKEN` prefixed — the user's `GITHUB_TOKEN` env var is invalid and the keyring login is what works.

```sh
unset GITHUB_TOKEN
gh issue create --repo mcp-rune/mcp-rune \
  --title "Epic: <title>" \
  --label epic,<scoped-labels> \
  --body "$(cat <<'EOF'
## Context

<3-6 sentence summary from step 1>

## Sub-issues

- [ ] #<placeholder>  — sub-item 1 title
- [ ] #<placeholder>  — sub-item 2 title
…

## Workflow

Per `AGENTS.md` § "Epic workflow for complex changes": each sub-issue ships as its own focused PR. The epic stays open as the source of truth and is closed with a summary table when the last sub-PR lands.
EOF
)"
```

Capture the returned URL — extract the epic number for the sub-issue bodies.

### 5. Report

Print the epic URL. Remind the user that sub-issues will be opened one at a time as each axis is decided. No trailing summary paragraph.

## Opening a sub-issue later (out-of-band)

When the user comes back later and says "open the sub-issue for axis N" (or equivalent), copy the axis section from the epic body into a focused sub-issue:

```sh
unset GITHUB_TOKEN
gh issue create --repo mcp-rune/mcp-rune \
  --title "<axis title>" \
  --label <axis target-labels>[,breaking] \
  --body "$(cat <<'EOF'
Part of epic #<epic-number>.

## Problem

<copied from the axis's Problem block, with file:line refs intact>

## Proposed change

<copied from the axis's Proposed change block>

<BREAKING note if applicable>
EOF
)"
```

Then edit the epic body to link the axis section to the new sub-issue (e.g. add `→ #NNN` after the axis heading). Don't rewrite the epic body wholesale — surgical edit only.

### "File all sub-issues now" variant

Only when the user explicitly opts in (e.g. "open the epic and all sub-issues"), additionally:

1. File each sub-issue in sequence (not parallel — numbers must be deterministic so the epic body can reference them).
2. After all sub-issues exist, edit the epic body once to add a `## Sub-issues` checklist with the real `#NNN` numbers so GitHub renders cross-issue references with live status.

## What NOT to do

- Don't open issues against any repo other than `mcp-rune/mcp-rune` unless the user explicitly names a different one.
- Don't apply `area:*` / `status:*` labels unprompted — that's Roadmap territory.
- Don't bundle unrelated findings into one sub-issue to keep the count small. Each sub-issue must map cleanly to one focused PR per the epic workflow.
- Don't open the issues in parallel — sub-issue numbers must be assigned in the order shown in the epic checklist.
- Don't include implementation code in the issue bodies. The epic and sub-issues describe _what_ and _why_; the PR is where code shows up.
- Don't auto-fire when the user merely _finishes_ a review. Wait for the explicit `/epic` ask.
