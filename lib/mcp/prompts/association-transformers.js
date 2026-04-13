/**
 * AssociationTransformer DSL
 *
 * A unified configuration layer for association handling in prompts and forms.
 *
 * Three transformer types:
 * - `select`:         Inline dropdown populated from API at form-open time
 * - `autocomplete`:   Visual picker UI before form opens (LLM pre-orchestrates)
 * - `multi_select`:   Multi-select picker UI before form opens
 *
 * Both prompts (PromptContentGenerator) and forms (form-schema.js) consume
 * the same transformer config, eliminating bespoke methods.
 */

/**
 * Build a map from target field names to their transformer config.
 * Handles both `targetField` (single) and `targetFields` (multiple).
 *
 * @param {Object} transformers - associationTransformers from prompt class
 * @returns {Map<string, Object>} fieldName → { ...transformer, key }
 */
export function buildFieldTransformerMap(transformers) {
  const map = new Map()
  for (const [key, transformer] of Object.entries(transformers)) {
    const entry = { ...transformer, key }
    if (transformer.targetField) {
      map.set(transformer.targetField, entry)
    }
    if (transformer.targetFields) {
      for (const field of transformer.targetFields) {
        map.set(field, entry)
      }
    }
  }
  return map
}

/**
 * Filter transformers by type.
 * @param {Object} transformers - associationTransformers from prompt class
 * @param {string} type - 'select', 'autocomplete', or 'multi_select'
 * @returns {Object[]} Array of { key, ...transformer }
 */
function filterByType(transformers, type) {
  return Object.entries(transformers)
    .filter(([, t]) => t.type === type)
    .map(([key, t]) => ({ key, ...t }))
}

/**
 * Get only `type: 'select'` transformers.
 * @param {Object} transformers
 * @returns {Object[]}
 */
export function getSelectTransformers(transformers) {
  return filterByType(transformers, 'select')
}

/**
 * Get only `type: 'autocomplete'` transformers.
 * @param {Object} transformers
 * @returns {Object[]}
 */
export function getAutocompleteTransformers(transformers) {
  return filterByType(transformers, 'autocomplete')
}

/**
 * Get only `type: 'multi_select'` transformers.
 * @param {Object} transformers
 * @returns {Object[]}
 */
export function getMultiSelectTransformers(transformers) {
  return filterByType(transformers, 'multi_select')
}

// ===========================================================================
// TRANSFORMER INSTRUCTION GENERATION
// ===========================================================================

/**
 * Find transformers whose target fields overlap with the given field names.
 *
 * Returns deduplicated transformer entries (by key) that cover at least one
 * of the provided field names. Used by the rendering pipeline to detect
 * which sections have transformer-managed fields.
 *
 * @param {Object} transformers - associationTransformers from prompt class
 * @param {string[]} fieldNames - Field names to check
 * @returns {Object[]} Array of { key, ...transformer } with no duplicates
 */
export function getTransformersForFields(transformers, fieldNames) {
  if (!transformers || !fieldNames?.length) return []
  const fieldTransformerMap = buildFieldTransformerMap(transformers)
  const seen = new Set()
  const result = []
  for (const fieldName of fieldNames) {
    const entry = fieldTransformerMap.get(fieldName)
    if (entry && !seen.has(entry.key)) {
      seen.add(entry.key)
      result.push(entry)
    }
  }
  return result
}

/**
 * Generate prompt instruction text for a single transformer.
 *
 * Produces context-aware instructions based on transformer type and
 * whether app tools (autocomplete_picker, multi_select_picker) are available.
 *
 * When `appsEnabled` is true:
 *   - autocomplete → picker as preferred method, find_model as fallback
 *   - select → notes that it appears as a dropdown in the form; find_model for guided mode
 *   - multi_select → multi_select_picker instructions
 *
 * When `appsEnabled` is false:
 *   - autocomplete → find_model only
 *   - select → find_model / get_field_suggestions
 *   - multi_select → find_model + manual collection
 *
 * @param {Object} transformer - { key, type, source, targetField?, targetFields?, ... }
 * @param {Object} [options]
 * @param {boolean} [options.appsEnabled=false] - Whether app tools are available
 * @returns {string} Markdown instruction text
 */
export function generateTransformerInstructions(transformer, { appsEnabled = false } = {}) {
  switch (transformer.type) {
    case 'autocomplete':
      return _generateAutocompleteInstructions(transformer, appsEnabled)
    case 'select':
      return _generateSelectInstructions(transformer, appsEnabled)
    case 'multi_select':
      return _generateMultiSelectInstructions(transformer, appsEnabled)
    default:
      return ''
  }
}

/**
 * Generate instructions for autocomplete transformers.
 * @private
 */
function _generateAutocompleteInstructions(transformer, appsEnabled) {
  const sourceLabel = transformer.source.group || transformer.source.model
  const pickerArg = transformer.source.group
    ? `group: "${transformer.source.group}"`
    : `model: "${transformer.source.model}"`

  // Build "after finding" field list from transform config
  const afterFindingFields = _getTargetFieldList(transformer)

  let text = `**You MUST identify the ${sourceLabel} before proceeding.**\n`

  if (appsEnabled) {
    text += `
### Preferred Method — Visual Picker

Open the picker so the user can search and select content visually:
\`\`\`
autocomplete_picker(${pickerArg})
\`\`\`

After the user selects content, retrieve the selection:
\`\`\`
get_selection(model: "<selected_model>")
\`\`\`

### Fallback Method — Manual Search
`
  } else {
    text += `
### Finding the Content
`
  }

  // Common find_model instructions
  text += `
Use \`find_model\` to search:
\`\`\`
find_model(model: "<model_name>", external_id: "<user_provided_id>")
\`\`\``

  // After finding content
  if (afterFindingFields.length > 0) {
    text += `

### After Finding Content

Once found, store these values:
${afterFindingFields.map((f) => `- **${f}**`).join('\n')}

Display the found content to the user for confirmation.

**DO NOT proceed to the next section until content is confirmed.**`
  }

  return text
}

/**
 * Generate instructions for select transformers.
 * @private
 */
function _generateSelectInstructions(transformer, appsEnabled) {
  const model = transformer.source.model
  const label = _titleCase(transformer.key)
  const targetField = transformer.targetField
  const valueField = transformer.valueField || 'id'

  if (appsEnabled) {
    return `In the interactive form, **${label}** appears as a dropdown populated from the API.

In guided mode, search for the ${model}:
\`\`\`
find_model(model: "${model}", search_params: { name: "<${model}_name>" })
\`\`\`

Or use autocomplete suggestions:
\`\`\`
get_field_suggestions(field: "${targetField}", query: "<search_term>")
\`\`\`

After finding, set \`${targetField}\` to the ${model}'s \`${valueField}\`.`
  }

  return `### Finding a ${_titleCase(model)}

\`\`\`
find_model(model: "${model}", search_params: { name: "<${model}_name>" })
\`\`\`

Or use autocomplete suggestions:
\`\`\`
get_field_suggestions(field: "${targetField}", query: "<search_term>")
\`\`\`

After finding, set \`${targetField}\` to the ${model}'s \`${valueField}\`.`
}

/**
 * Generate instructions for multi_select transformers.
 * @private
 */
function _generateMultiSelectInstructions(transformer, appsEnabled) {
  const model = transformer.source.model
  const label = _titleCase(transformer.key)
  let text = ''

  if (appsEnabled) {
    text += `Use the multi-select picker to choose ${label.toLowerCase()}:
\`\`\`
multi_select_picker(model: "${model}")
\`\`\``
  } else {
    text += `Search for each ${model} individually:
\`\`\`
find_model(model: "${model}", search_params: { name: "<${model}_name>" })
\`\`\`

Collect the results into the \`${transformer.targetField}\` array.`
  }

  // Add postCreate instructions if defined
  if (transformer.postCreate) {
    const pc = transformer.postCreate
    text += `

### Post-Creation Step

After the main record is created, for EACH selected ${model}:
\`\`\`
create_model(
  model: "${pc.model}",
  parent_resource: "${pc.parentPath}",
  attributes: ${JSON.stringify(pc.attributeMap).replace(/\$/g, '{selected_')}
)
\`\`\``
  }

  return text
}

/**
 * Extract target field names from a transformer's config.
 * @private
 */
function _getTargetFieldList(transformer) {
  if (transformer.targetFields) return [...transformer.targetFields]
  if (transformer.targetField) return [transformer.targetField]
  return []
}

/**
 * Convert snake_case to Title Case.
 * @private
 */
function _titleCase(name) {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
