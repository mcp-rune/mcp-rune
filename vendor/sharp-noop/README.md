# sharp-noop

A no-op stub for [`sharp`](https://www.npmjs.com/package/sharp), the native image-processing library.

## Why this exists

`mcp-kit` depends on [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers), which lists `sharp` as a transitive dependency for image pipelines (`RawImage`, vision models, etc.). `sharp` ships ~30MB of platform-specific native binaries and requires libvips at build time.

We only use the text-embedding pipeline (`src/services/embeddings.ts`), so the image-processing path is dead code for us. To skip the native install entirely, the root `package.json` includes:

```json
"overrides": { "sharp": "file:./vendor/sharp-noop" }
```

npm resolves the `sharp` specifier to this directory, which exports nothing. Result: zero native binaries downloaded, zero libvips build, faster `npm ci`, smaller container images.

## Why downstream consumers also need their own copy

npm `overrides` only take effect in the **root** `package.json` of the install — an `overrides` field declared inside a transitive dependency (like this one) is ignored. So any package that depends on `@dsaenztagarro/mcp-kit` and wants the same optimization must:

1. Vendor its own `sharp-noop` stub.
2. Add a root-level `overrides.sharp` pointing at it.

This directory is **not published** in the npm tarball (excluded from `package.json#files`) for that reason — it has no use to downstream consumers.

## When to remove this

The day `mcp-kit` starts using sharp (image pipelines, thumbnail generation, etc.), drop the override and let npm install the real package.
