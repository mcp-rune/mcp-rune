// mcp-rune/apps — registry, factories, schema generators
export { createAutocompletePickerApp } from './mcp/apps/autocomplete-picker.js'
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
export { generateListSchema } from './mcp/apps/list-schema.js'
export { createListViewApp } from './mcp/apps/list-view.js'
export { createCreateFormApp, createUpdateFormApp } from './mcp/apps/model-form.js'
export { createMultiSelectApp } from './mcp/apps/multi-select.js'
export { createRecordDetailApp } from './mcp/apps/record-detail.js'
export type { AppDefinition, FormatterDescriptor, ThemeOverrides } from './mcp/apps/registry.js'
export { AppRegistry } from './mcp/apps/registry.js'
export { createSearchViewApp } from './mcp/apps/search-view.js'
export { SelectionStore } from './mcp/apps/selection-store.js'
export { createSelectionTools } from './mcp/apps/selection-tools.js'
