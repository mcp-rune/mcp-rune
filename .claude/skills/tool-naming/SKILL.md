---
name: tool-naming
description: Invoke ONLY when the developer explicitly asks to name a new MCP tool or app (e.g. via `/tool-naming`, or "what should I call this tool"). Do NOT auto-trigger when reading or editing existing tools — the rules below are for choosing names for NEW tools and apps. Naming a wrong tool quietly is preferable to firing on every tool-touching edit.
---

# MCP Tool & App Naming

mcp-rune draws a sharp line between **app tools** (interactive UI surfaces) and **data tools** (perform mutations). The two name spaces follow opposite shapes so that reading a tool name immediately tells you which side of the seam it lives on.

## App tools — `<ui-verb>_model_app`

1. **Uniform `_app` suffix.** Every interactive MCP app tool ends in `_app`. No `_form`, no `_widget`, no other variants.

2. **Verb describes UI intent, not the underlying mutation.** The form for inputting a new record is `new_model_app` — it eventually triggers `create_model`, but its _purpose_ is "let the user fill in a new record." The form for editing is `edit_model_app` (triggers `update_model`). Read-only display is `show_model_app`. Browse / paginated table is `list_model_app`. Search is `search_model_app`. Pickers are `pick_model_app` / `multi_pick_model_app`. **Reserve `create_*` / `update_*` / `delete_*` for data tools that actually perform the mutation.**

3. **Object noun is `model` (singular), never `records` (plural).** `_model_` qualifies the app's _scope_ — "this app operates on instances of one model class" — not the cardinality of what it renders. `list_model_app` and `show_model_app` may still surface many records.

### Worked examples

| Wrong                | Right            | Why                                                            |
| -------------------- | ---------------- | -------------------------------------------------------------- |
| `create_model_form`  | `new_model_app`  | UI verb + `_app` suffix; `create_*` is the data tool           |
| `record_browser_app` | `list_model_app` | Singular `_model_` noun                                        |
| `update_model_app`   | `edit_model_app` | UI verb describes intent, not the mutation it eventually fires |
| `find_records_app`   | `find_model_app` | `_model_` for scope, not cardinality                           |

## Data tools — action verbs directly

Data tools take the opposite shape: imperative verbs with no `_app` or `_form` suffix.

- `create_model`, `update_model`, `delete_model` — single-record mutations
- `bulk_action_models` — multi-record mutation (plural because the action genuinely operates on many)
- `find_records`, `list_models` — read tools

The `find_records` / `list_models` plurality is intentional: data tools name the _result shape_ (many records, many models), while app tools name the _scope_ (one model class's UI).

## Cross-repo context

Profile filtering in `~/Code/engineer-mcp` ensures no profile exposes both an app and its data twin for the same operation (`chat` profile excludes the data tools; `agent` profile excludes apps). That's what lets the two name spaces overlap conceptually without colliding in practice — names can be chosen for clarity, not collision-avoidance.

## Quick checklist before merging a new tool

- [ ] App tool? Ends in `_app`. UI-intent verb. Singular `_model_` noun.
- [ ] Data tool? Action verb at the start. No `_app` suffix.
- [ ] Picked a verb? It describes what the **user** is doing, not what HTTP method or SQL statement the tool eventually issues.
- [ ] Checked you haven't accidentally named a form after its mutation (`create_*_app` is always wrong).
