# AGENTS.md

## Design Principles

- **Never design for backward compatibility.** When introducing a new pattern, apply it fully. Remove the old code path — do not keep fallback branches, shims, or deprecated re-exports. One way to do things, not two.
- **No speculative abstractions.** Only add complexity the task actually requires.
- **Delete, don't deprecate.** If something is replaced, remove it. No `@deprecated` aliases, no `// legacy fallback` branches, no re-exports of old names.
- **Tool responses stay concise.** Return a short summary string or a small JSON envelope. Never return per-record arrays from batch / bulk tools — sample errors or a count summary is enough. The LLM should never have to scroll a tool response. Full per-record results belong in the server log, not the context window.
- **No banner-comment section dividers.** Do not add `// ====…` separators (or `// ---` block dividers, or boxed `/** ===== Foo ===== */` headers) to chunk a file into "Types / Errors / Public API / Internals" sections. If a file is long enough that you feel the urge to add them, the file is doing too much — split it, collapse the grouping, or trust the reader to follow the symbol names. Whitespace + a one-line JSDoc on the symbol itself is enough.
