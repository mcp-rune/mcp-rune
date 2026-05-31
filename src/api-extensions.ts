// mcp-rune/api-extensions — types for authoring ApiExtensions.
// Built-in extensions will live under `@mcp-rune/mcp-rune/api-extensions/<name>`
// (mirroring the layout of `./extensions/cimd`). See docs/guides/api-extensions.md.
export type {
  SummaryInput,
  SummaryOutput,
  SummaryStrategy
} from './core/summary-strategies/types.js'
export type {
  ApiExtension,
  ApiExtensionCapability,
  ApiExtensionContext,
  ApiExtensionMap,
  ModelServiceMixin
} from './mcp/api-extensions/types.js'
