# AGENTS.md

## Design Principles

- **Never design for backward compatibility.** When introducing a new pattern, apply it fully. Remove the old code path — do not keep fallback branches, shims, or deprecated re-exports. One way to do things, not two.
- **No speculative abstractions.** Only add complexity the task actually requires.
- **Delete, don't deprecate.** If something is replaced, remove it. No `@deprecated` aliases, no `// legacy fallback` branches, no re-exports of old names.
