// mcp-rune/extensions — types for authoring HTTP and tool-flow extensions.
// Built-in extensions live under `@mcp-rune/mcp-rune/extensions/<name>`
// (e.g. `./extensions/cimd`, `./extensions/center-of-control`).
// See docs/guides/extensions.md.
export type {
  FormSubmitMode,
  ToolFlowExtension,
  ToolFlowExtensionCapability,
  ToolFlowExtensionContext,
  ToolFlowExtensionMap
} from './mcp/extensions/tool-flow.js'
export type {
  HttpExtension,
  HttpExtensionCapability,
  HttpExtensionContext,
  HttpExtensionMap
} from './mcp/extensions/types.js'
