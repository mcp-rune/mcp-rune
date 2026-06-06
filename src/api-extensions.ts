// mcp-rune/api-extensions — types for authoring ApiExtensions.
// Built-in extensions will live under `@mcp-rune/mcp-rune/api-extensions/<name>`
// (mirroring the layout of `./extensions/cimd`). See docs/guides/api-extensions.md.
export type {
  SummaryInput,
  SummaryOutput,
  SummaryStrategy
} from './mcp/analysis-layer/summary-strategies/types.js'
export type {
  ApiExtension,
  ApiExtensionCapability,
  ApiExtensionContext,
  ApiExtensionMap,
  ModelServiceMixin
} from './mcp/data-layer/api-extensions/types.js'
