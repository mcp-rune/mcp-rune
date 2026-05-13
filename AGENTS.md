# AGENTS.md

## Design Principles

- **Never design for backward compatibility.** When introducing a new pattern, apply it fully. Remove the old code path — do not keep fallback branches, shims, or deprecated re-exports. One way to do things, not two.
- **No speculative abstractions.** Only add complexity the task actually requires.
- **Delete, don't deprecate.** If something is replaced, remove it. No `@deprecated` aliases, no `// legacy fallback` branches, no re-exports of old names.
- **Tool responses stay concise.** Return a short summary string or a small JSON envelope. Never return per-record arrays from batch / bulk tools — sample errors or a count summary is enough. The LLM should never have to scroll a tool response. Full per-record results belong in the server log, not the context window.
