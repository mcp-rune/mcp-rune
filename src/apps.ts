// mcp-rune/apps — registry, factories, schema generators
export { BaseForm } from './mcp/apps/base-form.js'
export type {
  DefaultAppName,
  DefaultAppRegistryOptions
} from './mcp/apps/create-default-registry.js'
export { createDefaultAppRegistry } from './mcp/apps/create-default-registry.js'
export { generateDetailSchema } from './mcp/apps/detail-schema.js'
export { createFormDataTools } from './mcp/apps/form-data-tools.js'
export { generateFormSchema } from './mcp/apps/form-schema.js'
export { humanize, pluralize } from './mcp/apps/helpers.js'
export { createListModelApp } from './mcp/apps/list-model-app.js'
export { generateListSchema } from './mcp/apps/list-schema.js'
export { createEditModelApp, createNewModelApp } from './mcp/apps/model-form.js'
export { createMultiPickModelApp } from './mcp/apps/multi-pick-model-app.js'
export { createPickModelApp } from './mcp/apps/pick-model-app.js'
export type { AppDefinition, FormatterDescriptor, ThemeOverrides } from './mcp/apps/registry.js'
export { AppRegistry } from './mcp/apps/registry.js'
export { createSearchModelApp } from './mcp/apps/search-model-app.js'
export { SelectionStore } from './mcp/apps/selection-store.js'
export { createSelectionTools } from './mcp/apps/selection-tools.js'
export { createShowModelApp } from './mcp/apps/show-model-app.js'
