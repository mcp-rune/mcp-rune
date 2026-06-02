/**
 * Generic Model Form MCP App — Client-side shared bootstrap.
 *
 * Used by both `new-model-app/ui/app.js` and `edit-model-app/ui/app.js`. The
 * mode (create vs update) is set at runtime from the `mode` field on the
 * server's tool result, so the per-app entry point is a thin call into
 * `initModelFormApp()` with no per-app variant logic.
 */

import { App } from '@modelcontextprotocol/ext-apps'

import { initApp, showStatus, clearStatus } from '../app-init.js'
import { getFormatter } from '../formatters.js'
import '../formatters.runtime.js'
import { humanize } from '../helpers.js'

/**
 * Wire up the form app: connects to the MCP host, registers tool-result
 * handlers, renders the form on first result, and routes Done to the
 * appropriate server-side tool.
 */
export async function initModelFormApp() {
  // ─── State ────────────────────────────────────────────────────────────────

  let formSchema = null
  let modelName = null
  let formMode = 'create' // 'create' or 'update'
  let submitMode = 'direct' // 'direct' or 'collect' — server-advertised
  let recordId = null // populated in update mode
  let hiddenValues = {} // server-side prefill not rendered as fields
  let parentContext = null // { parentModel, parentId, label } when nested

  // ─── MCP App Connection ───────────────────────────────────────────────────

  const app = new App({ name: 'Model Form', version: '1.0.0' })

  app.ontoolinput = (params) => {
    if (params?.arguments) {
      prefillForm(params.arguments)
    }
  }

  app.ontoolresult = (result) => {
    try {
      const textContent = result?.content?.find((c) => c.type === 'text')
      if (!textContent) return
      const data = JSON.parse(textContent.text)

      if (data.schema) {
        formSchema = data.schema
        modelName = data.schema.model
        formMode = data.mode || 'create'
        submitMode = data.submitMode || 'direct'
        recordId = data.recordId || null
        hiddenValues = data.hiddenValues || {}
        parentContext = data.parentContext || null
        renderForm(data.schema)
        if (data.defaults) {
          prefillForm(data.defaults)
        }
        updateSubmitGate()
      } else {
        prefillForm(data.defaults || data)
        updateSubmitGate()
      }
    } catch {
      /* ignore parse errors */
    }
  }

  await app.connect()
  initApp(app)

  // ─── Form Rendering ───────────────────────────────────────────────────────

  /** Field types that render with inline option labels and need stacked layout */
  const STACKED_TYPES = new Set(['checkbox_group', 'multiselect', 'checkbox'])

  /**
   * Tiny CSS attribute-selector escape. Field names are model attribute
   * identifiers (`/^[a-z_][a-z0-9_]*$/i`), so we only need to escape the
   * handful of characters that can occur defensively. Avoids reaching for
   * the browser-only `CSS.escape` global which ESLint's node env doesn't know.
   */
  function cssEscape(value) {
    return String(value).replace(/(["\\])/g, '\\$1')
  }

  /**
   * Render the entire form from a schema
   * @param {Object} schema - Form schema with fieldsets and fields
   */
  function renderForm(schema) {
    const form = document.getElementById('model-form')
    form.innerHTML = ''

    // Update header based on mode
    const isUpdate = formMode === 'update'
    document.getElementById('form-title').textContent = isUpdate
      ? `Edit ${humanize(schema.model)}`
      : schema.title
    document.getElementById('form-subtitle').textContent = isUpdate
      ? `Update ${schema.model} details`
      : `Add a new ${schema.model} to your library`

    renderParentContextBanner(form)

    // Group fields by their group key
    const fieldsByGroup = new Map()
    for (const field of schema.fields) {
      if (!fieldsByGroup.has(field.group)) {
        fieldsByGroup.set(field.group, [])
      }
      fieldsByGroup.get(field.group).push(field)
    }

    // Render fields directly (no fieldset/legend wrappers)
    for (const fieldset of schema.fieldsets) {
      for (const groupKey of fieldset.groups) {
        const groupFields = fieldsByGroup.get(groupKey) || []
        const layout = schema.groupLayouts?.[groupKey]
        form.appendChild(renderFieldGroup(groupFields, layout))
      }
    }

    // Wire up conditional visibility for fields with visibleWhen rules
    setupConditionalVisibility(schema.fields)

    // Hook required-field gating to enable/disable the submit button live.
    setupSubmitGating(schema.fields)

    // Show action buttons
    document.getElementById('form-actions').style.display = 'flex'
  }

  /**
   * Render the nested-parent context banner above the form when the server
   * resolved a parent record. The server already humanized the parent label;
   * we just frame it as "Adding {modelName} to {label}".
   *
   * @param {HTMLElement} form
   */
  function renderParentContextBanner(form) {
    if (!parentContext || !parentContext.label) return
    const banner = document.createElement('div')
    banner.className = 'parent-banner'
    banner.dataset.parentModel = parentContext.parentModel
    banner.dataset.parentId = parentContext.parentId

    const heading = document.createElement('strong')
    heading.textContent = `${humanize(parentContext.parentModel)}:`

    const value = document.createElement('span')
    value.textContent = parentContext.label

    banner.appendChild(heading)
    banner.appendChild(value)
    form.appendChild(banner)
  }

  /**
   * Render a group of fields with optional layout
   * @param {Object[]} fields - Field definitions
   * @param {Object} [layout] - Layout config (e.g., { type: 'row' })
   * @returns {DocumentFragment|HTMLElement}
   */
  function renderFieldGroup(fields, layout) {
    if (layout?.type === 'row') {
      const row = document.createElement('div')
      row.className = 'field-row'
      for (const field of fields) row.appendChild(renderField(field))
      return row
    }

    // Default: render fields sequentially
    const fragment = document.createDocumentFragment()
    for (const field of fields) fragment.appendChild(renderField(field))
    return fragment
  }

  /**
   * Render a single form field
   * @param {Object} field - Field definition from schema
   * @returns {HTMLElement} Field container element
   */
  function renderField(field) {
    const container = document.createElement('div')
    container.className = STACKED_TYPES.has(field.type) ? 'field field--stacked' : 'field'
    container.dataset.field = field.name

    // Label
    const label = document.createElement('label')
    label.setAttribute('for', field.name)
    label.textContent = field.label
    if (field.required) {
      const req = document.createElement('span')
      req.className = 'required'
      req.textContent = ' *'
      label.appendChild(req)
    }
    container.appendChild(label)

    // Input element based on type
    switch (field.type) {
      case 'text':
      case 'url':
      case 'email':
      case 'date':
      case 'datetime-local':
      case 'time':
      case 'color':
        container.appendChild(createInput(field))
        break
      case 'number':
        container.appendChild(createNumberInput(field))
        break
      case 'textarea':
        container.appendChild(createTextarea(field))
        break
      case 'select':
        container.appendChild(
          field.options && field.options.length > 10
            ? createSearchableSelect(field)
            : createSelect(field)
        )
        break
      case 'multiselect':
        container.appendChild(createMultiselect(field))
        break
      case 'checkbox_group':
        container.appendChild(createCheckboxGroup(field))
        break
      case 'checkbox':
        container.appendChild(createCheckbox(field))
        break
      case 'file':
        // Skip file fields in the generic form (base64 uploads not supported in MCP Apps)
        break
      default:
        // Surface the silent fallback so future drift between the server-side
        // schema generator and this switch is visible in devtools. validateRegistries
        // catches every model-driven case at boot; this warning fires only when
        // the server emits a field.type the client doesn't recognise — i.e. when
        // someone added a new kind in kind-metadata.ts but forgot to wire it here.
        console.warn(
          `[mcp-rune] Unknown field.type "${field.type}" for field "${field.name}". ` +
            `Rendering as <input type="text">. Add a case to renderField() in shared/model-form/main.js.`
        )
        container.appendChild(createInput(field))
    }

    return container
  }

  // ─── Field Renderers ─────────────────────────────────────────────────────

  // HTML5 input `type` values we honor directly. Anything outside this set
  // falls back to `text` so we never end up with `type="undefined"`.
  const NATIVE_INPUT_TYPES = new Set([
    'text',
    'url',
    'email',
    'date',
    'datetime-local',
    'time',
    'color'
  ])

  function createInput(field) {
    const input = document.createElement('input')
    input.type = NATIVE_INPUT_TYPES.has(field.type) ? field.type : 'text'
    input.id = field.name
    input.name = field.name
    if (field.placeholder) input.placeholder = field.placeholder
    if (field.required) input.required = true
    if (field.default) input.value = field.default
    return input
  }

  function createNumberInput(field) {
    const input = document.createElement('input')
    input.type = 'number'
    input.id = field.name
    input.name = field.name
    if (field.placeholder) input.placeholder = field.placeholder
    if (field.validation?.min !== undefined) input.min = field.validation.min
    if (field.validation?.max !== undefined) input.max = field.validation.max
    if (field.default !== undefined) input.value = field.default
    return input
  }

  function createTextarea(field) {
    const textarea = document.createElement('textarea')
    textarea.id = field.name
    textarea.name = field.name
    textarea.rows = 3
    if (field.placeholder) textarea.placeholder = field.placeholder
    return textarea
  }

  function createSelect(field) {
    const select = document.createElement('select')
    select.id = field.name
    select.name = field.name

    // Blank option
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = field.association ? `Select ${field.label.toLowerCase()}…` : `Select…`
    select.appendChild(blank)

    // Options (from enum values or association data)
    if (field.options) {
      for (const opt of field.options) {
        const option = document.createElement('option')
        option.value = opt.value
        option.textContent = opt.label
        if (field.default !== undefined && String(opt.value) === String(field.default)) {
          option.selected = true
        }
        select.appendChild(option)
      }
    }

    return select
  }

  function createSearchableSelect(field) {
    const wrapper = document.createElement('div')
    wrapper.className = 'searchable-select'

    const hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.id = field.name
    hidden.name = field.name
    if (field.default !== undefined) hidden.value = field.default

    const search = document.createElement('input')
    search.type = 'text'
    search.className = 'searchable-select__input'
    search.placeholder = `Search ${field.label.toLowerCase()}…`
    search.autocomplete = 'off'

    const dropdown = document.createElement('div')
    dropdown.className = 'searchable-select__dropdown'

    // Set initial display text from default value
    if (field.default !== undefined && field.options) {
      const match = field.options.find((o) => String(o.value) === String(field.default))
      if (match) search.value = match.label
    }

    function renderOptions(query) {
      dropdown.innerHTML = ''
      const q = (query || '').toLowerCase()
      const filtered = field.options.filter((o) => o.label.toLowerCase().includes(q))

      if (filtered.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'searchable-select__empty'
        empty.textContent = 'No matches'
        dropdown.appendChild(empty)
      } else {
        for (const opt of filtered.slice(0, 20)) {
          const item = document.createElement('div')
          item.className = 'searchable-select__option'
          item.textContent = opt.label
          item.dataset.value = opt.value
          item.addEventListener('mousedown', (e) => {
            e.preventDefault()
            hidden.value = opt.value
            search.value = opt.label
            dropdown.style.display = 'none'
          })
          dropdown.appendChild(item)
        }
      }
      dropdown.style.display = 'block'
    }

    search.addEventListener('focus', () => renderOptions(search.value))
    search.addEventListener('input', () => renderOptions(search.value))
    search.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.style.display = 'none'
      }, 150)
    })

    wrapper.appendChild(hidden)
    wrapper.appendChild(search)
    wrapper.appendChild(dropdown)
    return wrapper
  }

  function createMultiselect(field) {
    const wrapper = document.createElement('div')
    wrapper.className = 'multiselect-group'
    wrapper.dataset.field = field.name

    if (!field.options || field.options.length === 0) {
      const empty = document.createElement('span')
      empty.className = 'empty-options'
      empty.textContent = `No ${field.label.toLowerCase()} available`
      wrapper.appendChild(empty)
      return wrapper
    }

    for (const opt of field.options) {
      const label = document.createElement('label')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.name = field.name
      cb.value = opt.value

      const text = document.createElement('span')
      text.textContent = opt.label

      // Color indicator for tags
      if (opt.color) {
        const dot = document.createElement('span')
        dot.className = 'color-dot'
        dot.style.backgroundColor = opt.color
        label.appendChild(cb)
        label.appendChild(dot)
        label.appendChild(text)
      } else {
        label.appendChild(cb)
        label.appendChild(text)
      }

      wrapper.appendChild(label)
    }

    return wrapper
  }

  function createCheckboxGroup(field) {
    const wrapper = document.createElement('div')
    wrapper.className = 'checkbox-group'

    for (const opt of field.options || []) {
      const label = document.createElement('label')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.name = field.name
      cb.value = opt.value
      label.appendChild(cb)
      label.appendChild(document.createTextNode(' ' + opt.label))
      wrapper.appendChild(label)
    }

    return wrapper
  }

  function createCheckbox(field) {
    const label = document.createElement('label')
    label.className = 'checkbox-label'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.id = field.name
    cb.name = field.name
    label.appendChild(cb)
    label.appendChild(document.createTextNode(' ' + field.label))
    return label
  }

  // ─── Conditional Visibility ──────────────────────────────────────────────

  /**
   * Set up conditional visibility for fields with visibleWhen rules.
   *
   * A field with `visibleWhen: { field: 'status', equals: 'active' }` is
   * shown only when the controlling field has the specified value. The rule
   * also supports `notEquals` for inverse conditions.
   *
   * @param {Object[]} fields - Field definitions from schema
   */
  function setupConditionalVisibility(fields) {
    const conditionalFields = fields.filter((f) => f.visibleWhen)
    if (conditionalFields.length === 0) return

    const form = document.getElementById('model-form')

    for (const field of conditionalFields) {
      const rule = field.visibleWhen
      const controlEl = form.querySelector(`[name="${rule.field}"]`)
      if (!controlEl) continue

      const container = form.querySelector(`.field[data-field="${field.name}"]`)
      if (!container) continue

      const evaluate = () => {
        const val = controlEl.value
        let visible = true
        if (rule.equals !== undefined) visible = val === String(rule.equals)
        if (rule.notEquals !== undefined) visible = val !== String(rule.notEquals)
        container.style.display = visible ? '' : 'none'
      }

      controlEl.addEventListener('change', evaluate)
      controlEl.addEventListener('input', evaluate)
      evaluate() // Initial evaluation
    }
  }

  // ─── Submit Gating ───────────────────────────────────────────────────────

  /**
   * Wire `input` / `change` listeners on every required-field control so the
   * submit button reflects validity in real time. Idempotent — each call wipes
   * the existing listeners by recreating the button (cheap and avoids leaks).
   *
   * @param {Object[]} fields - Field definitions from schema
   */
  function setupSubmitGating(fields) {
    const form = document.getElementById('model-form')
    for (const field of fields) {
      if (!field.required) continue
      // multiselect / checkbox_group have one input per option — bind to all.
      const inputs = form.querySelectorAll(`[name="${field.name}"]`)
      for (const input of inputs) {
        input.addEventListener('input', updateSubmitGate)
        input.addEventListener('change', updateSubmitGate)
      }
    }
    updateSubmitGate()
  }

  /**
   * Toggle the `[disabled]` attribute on the Done button based on whether all
   * required fields currently hold a non-empty value. Cheap to call from any
   * change handler — there's no full form serialization in the hot path.
   */
  function updateSubmitGate() {
    const btn = document.getElementById('btn-done')
    if (!btn) return
    if (!formSchema) {
      btn.disabled = false
      return
    }
    const form = document.getElementById('model-form')
    const requiredFields = formSchema.fields.filter((f) => f.required)
    for (const field of requiredFields) {
      // Skip fields hidden by visibleWhen — they're not part of "required" right now.
      const container = form.querySelector(`.field[data-field="${field.name}"]`)
      if (container && container.style.display === 'none') continue
      if (!hasValue(form, field)) {
        btn.disabled = true
        return
      }
    }
    btn.disabled = false
  }

  /**
   * Whether the in-DOM controls for `field` currently hold a non-empty value.
   * Handles the special shapes (multiselect / checkbox_group, checkbox) without
   * routing through the slow `collectFormData` pipeline.
   */
  function hasValue(form, field) {
    switch (field.type) {
      case 'multiselect':
      case 'checkbox_group':
        return form.querySelectorAll(`input[name="${field.name}"]:checked`).length > 0
      case 'checkbox':
        return form.querySelector(`#${cssEscape(field.name)}`)?.checked === true
      default: {
        const el = form.querySelector(`#${cssEscape(field.name)}`)
        if (!el) return false
        return el.value !== undefined && el.value !== null && String(el.value).trim() !== ''
      }
    }
  }

  // ─── Form Data Collection ────────────────────────────────────────────────

  /**
   * Collect all form data as a plain object, filtering empty values
   * @returns {Object} Form data
   */
  function collectFormData() {
    if (!formSchema) return {}

    const data = {}

    const form = document.getElementById('model-form')

    for (const field of formSchema.fields) {
      // Skip conditionally hidden fields
      const container = form.querySelector(`.field[data-field="${field.name}"]`)
      if (container && container.style.display === 'none') continue

      switch (field.type) {
        case 'checkbox_group':
        case 'multiselect': {
          const checked = []
          for (const cb of form.querySelectorAll(`input[name="${field.name}"]:checked`)) {
            const val = field.type === 'multiselect' ? Number(cb.value) : cb.value
            checked.push(isNaN(val) ? cb.value : val)
          }
          if (checked.length > 0) data[field.name] = checked
          break
        }
        case 'checkbox': {
          const el = document.getElementById(field.name)
          if (el?.checked) data[field.name] = true
          break
        }
        case 'file':
          // Skip file fields
          break
        default: {
          const el = document.getElementById(field.name)
          if (!el) break
          const val = el.value.trim()
          if (val === '') break

          // Route through the bidirectional formatter when the field's
          // model kind is known. Falls back to the legacy number/text coercion
          // when the schema didn't propagate `kind` (e.g. association selects).
          if (field.kind) {
            const fmt = getFormatter(field.kind, field.format)
            data[field.name] = fmt.serialize(fmt.fromInput(val))
          } else if (field.type === 'number' || field.type === 'select') {
            const num = Number(val)
            data[field.name] = !isNaN(num) && val !== '' ? num : val
          } else {
            data[field.name] = val
          }
        }
      }
    }

    return data
  }

  // ─── Form Prefill ────────────────────────────────────────────────────────

  /**
   * Prefill form fields from a values object
   * @param {Object} values - Key-value pairs to set
   */
  function prefillForm(values) {
    if (!values) return
    const form = document.getElementById('model-form')
    const fieldByName = new Map((formSchema?.fields ?? []).map((f) => [f.name, f]))

    for (const [key, val] of Object.entries(values)) {
      if (val === null || val === undefined || val === '') continue

      // Handle checkbox groups and multiselects
      if (Array.isArray(val)) {
        for (const cb of form.querySelectorAll(`input[name="${key}"]`)) {
          cb.checked = val.includes(cb.value) || val.includes(Number(cb.value))
        }
        continue
      }

      const field = fieldByName.get(key)

      // Handle regular inputs and selects, routing API value through the
      // bidirectional formatter so kinds like `datetime` / `date` / `time`
      // land in the right HTML <input> shape.
      const input = document.getElementById(key)
      if (!input) continue

      if (field?.kind) {
        const fmt = getFormatter(field.kind, field.format)
        input.value = fmt.toInput(fmt.parse(val))
      } else {
        input.value = val
      }
    }
  }

  // ─── Status & Errors ─────────────────────────────────────────────────────

  const statusBar = document.getElementById('status-bar')

  function clearFieldErrors() {
    const form = document.getElementById('model-form')
    for (const el of form.querySelectorAll('.has-error')) {
      el.classList.remove('has-error')
      const errMsg = el.querySelector('.error-msg')
      if (errMsg) errMsg.remove()
    }
  }

  function showFieldError(fieldName, message) {
    const form = document.getElementById('model-form')
    // Find by data-field attribute on container or by input name
    let container = form.querySelector(`.field[data-field="${fieldName}"]`)
    if (!container) {
      const field = form.querySelector(`[name="${fieldName}"]`)
      if (!field) return
      container = field.closest('.field')
    }
    if (!container) return

    container.classList.add('has-error')
    const errEl = document.createElement('div')
    errEl.className = 'error-msg'
    errEl.textContent = message
    container.appendChild(errEl)
  }

  // ─── Button Handlers ─────────────────────────────────────────────────────

  document.getElementById('btn-done').addEventListener('click', async () => {
    clearFieldErrors()
    clearStatus(statusBar)

    const fields = collectFormData()

    // Basic client-side required-field check (defensive — the submit gate
    // should already disable the button, but a hidden-via-visibleWhen field
    // can sneak through if the user re-shows it without input).
    if (formSchema) {
      const requiredFields = formSchema.fields.filter((f) => f.required)
      const missing = requiredFields.filter((f) => !fields[f.name])
      if (missing.length > 0) {
        for (const f of missing) {
          showFieldError(f.name, `${f.label} is required`)
        }
        showStatus(
          statusBar,
          `${missing.length} required field${missing.length !== 1 ? 's' : ''} missing`,
          'error'
        )
        return
      }
    }

    const label = humanize(modelName)

    if (submitMode === 'collect') {
      // Center-of-Control flow: the form stages the data into FormDataStore
      // and the LLM owns the review/confirm/submit handoff. Surfaced via the
      // built-in centerOfControlExtension.
      showStatus(statusBar, 'Saving form data…', 'info')
      try {
        await app.callServerTool({
          name: 'collect_form_data',
          arguments: { model: modelName, fields, mode: formMode }
        })
        const summary = `${label} form data collected — ready for review`
        showStatus(statusBar, summary, 'success')
        app.sendLog({ level: 'info', data: { type: 'completed', summary } })
      } catch (err) {
        showStatus(statusBar, 'Error: ' + err.message, 'error')
      }
      return
    }

    // Standard flow: form submission calls create_model / update_model directly.
    const isUpdate = formMode === 'update'
    const toolName = isUpdate ? 'update_model' : 'create_model'
    const verbing = isUpdate ? 'Updating' : 'Creating'
    showStatus(statusBar, `${verbing} ${label.toLowerCase()}…`, 'info')

    try {
      const attributes = { ...hiddenValues, ...fields }
      const toolArgs = { model: modelName, attributes }
      if (isUpdate && recordId) {
        toolArgs.id = recordId
      }
      const result = await app.callServerTool({ name: toolName, arguments: toolArgs })

      // Surface server-side validation errors (422) as inline field errors when possible.
      const errorPayload = parseToolError(result)
      if (errorPayload) {
        const { fieldErrors, message } = errorPayload
        for (const [name, msg] of Object.entries(fieldErrors)) {
          showFieldError(name, msg)
        }
        showStatus(statusBar, message || 'Submission failed', 'error')
        return
      }

      const summary = isUpdate ? `${label} updated` : `${label} created`
      showStatus(statusBar, summary, 'success')
      app.sendLog({ level: 'info', data: { type: 'completed', summary } })
    } catch (err) {
      showStatus(statusBar, 'Error: ' + err.message, 'error')
    }
  })

  /**
   * Extract field-level errors from a tool result. The server returns errors as
   * { isError: true, content: [{ text: JSON | string }] }. Falls back to a flat
   * message when no per-field details are present.
   *
   * @param {Object} result - Tool call result from app.callServerTool
   * @returns {{ fieldErrors: Object<string,string>, message?: string } | null}
   */
  function parseToolError(result) {
    if (!result?.isError) return null
    const text = result.content?.find?.((c) => c.type === 'text')?.text
    if (!text) return { fieldErrors: {}, message: 'Submission failed' }
    try {
      const parsed = JSON.parse(text)
      const errors = parsed.errors || parsed.error?.errors
      if (errors && typeof errors === 'object') {
        const fieldErrors = {}
        for (const [name, val] of Object.entries(errors)) {
          fieldErrors[name] = Array.isArray(val) ? val.join('; ') : String(val)
        }
        return { fieldErrors, message: parsed.message || parsed.error?.message }
      }
      return { fieldErrors: {}, message: parsed.message || parsed.error || text }
    } catch {
      return { fieldErrors: {}, message: text }
    }
  }
}
