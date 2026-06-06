# AGENTS.md

## App tool naming

MCP app tool names follow `<ui-verb>_model_app`. Three rules:

1. **Uniform `_app` suffix.** Every interactive MCP app tool ends in `_app`. No `_form` or other variants.
2. **Verb describes UI intent, not the underlying mutation.** The form for a new record is `new_model_app` (it eventually triggers `create_model`). The form for editing is `edit_model_app` (triggers `update_model`). Read-only display is `show_model_app`. Browse / paginated table is `list_model_app`. Search is `search_model_app`. Reserve `create_*` / `update_*` / `delete_*` for **data tools that perform the mutation**.
3. **Object noun is `model` (singular), never `records` (plural).** `_model_` qualifies the app's scope — "this app operates on instances of one model class" — not the cardinality of what it renders. `list_model_app` and `show_model_app` may still surface many records.

Profile filtering in `~/Code/engineer-mcp` ensures no profile exposes both an app and its data twin for the same operation (`chat` profile excludes the data tools; `agent` profile excludes apps), so names can be chosen for clarity rather than collision-avoidance.

Data tools take the opposite shape: action verbs directly (`create_model`, `update_model`, `delete_model`, `bulk_action_models`, `find_records`, `list_models`).

## Roadmap

Workflow for the public Roadmap (milestones, `area:*` / `status:*` / `shipped-in:*` labels, theme convergence) lives in the local `roadmap` skill at `.claude/skills/roadmap/SKILL.md`. Invoke it explicitly with `/roadmap` when you're about to open, label, close, or milestone-manage a Roadmap-relevant issue. It is intentionally opt-in (not auto-loaded) while the project is in heavy BREAKING-changes phase, since almost any issue could plausibly be Roadmap-relevant and auto-firing would defeat the extraction.
