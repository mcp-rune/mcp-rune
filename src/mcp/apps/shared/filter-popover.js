/**
 * Interactive filter editor for MCP App table views.
 *
 * Drives a popover panel containing one row per active filter:
 * `[type-selector] [value-input] [remove]`. "Add filter" appends a new
 * row populated from any unused filter definition; "Clear all" empties
 * the panel; "Apply" gathers the row values into a filter object and
 * dispatches `onApply(filters)`.
 *
 * Filter metadata comes from the app's payload (`filterDefinitions`,
 * which is `getSearchConfig(ModelClass).filters`). The popover does not
 * invent type information — supported shapes:
 *
 *   - `{ type: 'text' }`              → <input type="text">
 *   - `{ type: 'enum', enumValues }`  → <select> from enumValues
 *   - `{ type: 'relation' }`          → <input type="text"> (id string)
 *   - `{ type: 'date_range' }`        → two <input type="date">
 *   - `{ type: 'integer_range' | 'numeric_range' }` → two <input type="number">
 *
 * Any unknown type falls back to a plain text input.
 */

import { humanize, escapeHtml } from './helpers.js'

/**
 * @param {Object} options
 * @param {HTMLElement} options.trigger - Button that toggles the panel.
 * @param {HTMLElement} options.panel - Container element for the popover.
 * @param {HTMLElement} options.rowsContainer - Where filter rows are rendered.
 * @param {HTMLElement} options.addBtn - "Add filter" button.
 * @param {HTMLElement} options.clearBtn - "Clear all" button.
 * @param {HTMLElement} options.applyBtn - "Apply" button.
 * @param {() => Object} options.getDefinitions - Returns the current filterDefinitions map.
 * @param {() => Object} options.getCurrentFilters - Returns the currently applied filters.
 * @param {(filters: Object) => void} options.onApply - Called with the gathered filter values.
 */
export function createFilterPopover({
  trigger,
  panel,
  rowsContainer,
  addBtn,
  clearBtn,
  applyBtn,
  getDefinitions,
  getCurrentFilters,
  onApply
}) {
  function open() {
    syncRowsFromCurrentFilters()
    panel.style.display = 'flex'
  }

  function close() {
    panel.style.display = 'none'
  }

  function toggle() {
    if (panel.style.display === 'none' || !panel.style.display) {
      open()
    } else {
      close()
    }
  }

  function syncRowsFromCurrentFilters() {
    rowsContainer.innerHTML = ''
    const filters = getCurrentFilters() || {}
    const defs = getDefinitions() || {}
    const keys = Object.keys(filters)
    if (keys.length === 0) {
      // Seed with one empty row so the user has something to fill in.
      appendRow(null, defs, filters)
      return
    }
    for (const name of keys) {
      appendRow(name, defs, filters)
    }
  }

  function appendRow(initialName, definitions, currentFilters) {
    const row = document.createElement('div')
    row.className = 'mr-popover-row'

    const select = document.createElement('select')
    select.className = 'field-type'
    const usedKeys = new Set(getUsedKeys(rowsContainer))
    const allKeys = Object.keys(definitions)
    const optionKeys = allKeys.filter((k) => k === initialName || !usedKeys.has(k))
    if (optionKeys.length === 0 && allKeys.length > 0) optionKeys.push(allKeys[0])

    for (const key of optionKeys) {
      const opt = document.createElement('option')
      opt.value = key
      opt.textContent = definitions[key]?.label || humanize(key)
      if (key === initialName) opt.selected = true
      select.appendChild(opt)
    }
    row.appendChild(select)

    const valueWrap = document.createElement('span')
    valueWrap.className = 'field-value'
    row.appendChild(valueWrap)

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'btn-remove'
    removeBtn.textContent = '×'
    removeBtn.title = 'Remove filter'
    removeBtn.addEventListener('click', () => row.remove())
    row.appendChild(removeBtn)

    function renderValueInput(filterName) {
      valueWrap.innerHTML = ''
      const def = definitions[filterName] || {}
      const initialValue = initialName === filterName ? currentFilters[filterName] : undefined
      const input = buildInput(def, initialValue)
      valueWrap.appendChild(input)
    }

    select.addEventListener('change', () => renderValueInput(select.value))
    renderValueInput(select.value)

    rowsContainer.appendChild(row)
  }

  function getUsedKeys(container) {
    return Array.from(container.querySelectorAll('select.field-type')).map((s) => s.value)
  }

  function buildInput(definition, initialValue) {
    const type = definition.type || 'text'

    if (type === 'enum' && Array.isArray(definition.enumValues)) {
      const select = document.createElement('select')
      select.dataset.kind = 'enum'
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = '— Any —'
      select.appendChild(blank)
      for (const v of definition.enumValues) {
        const opt = document.createElement('option')
        opt.value = String(v)
        opt.textContent = humanize(String(v))
        if (String(initialValue) === String(v)) opt.selected = true
        select.appendChild(opt)
      }
      return select
    }

    if (type === 'date_range' || type === 'integer_range' || type === 'numeric_range') {
      const wrap = document.createElement('span')
      wrap.className = 'field-range'
      wrap.dataset.kind = type
      const inputType = type === 'date_range' ? 'date' : 'number'
      const from = document.createElement('input')
      from.type = inputType
      from.placeholder = 'from'
      const to = document.createElement('input')
      to.type = inputType
      to.placeholder = 'to'

      if (initialValue && typeof initialValue === 'object') {
        const fromKey = initialValue.from !== undefined ? 'from' : 'min'
        const toKey = initialValue.to !== undefined ? 'to' : 'max'
        if (initialValue[fromKey] != null) from.value = String(initialValue[fromKey])
        if (initialValue[toKey] != null) to.value = String(initialValue[toKey])
      }

      wrap.appendChild(from)
      const sep = document.createElement('span')
      sep.textContent = '–'
      wrap.appendChild(sep)
      wrap.appendChild(to)
      return wrap
    }

    const input = document.createElement('input')
    input.type = 'text'
    input.dataset.kind = type
    input.placeholder = escapeHtml(definition.label || '')
    if (initialValue != null) input.value = String(initialValue)
    return input
  }

  function collectFilters() {
    const filters = {}
    const rows = rowsContainer.querySelectorAll('.mr-popover-row')
    for (const row of rows) {
      const select = row.querySelector('select.field-type')
      if (!select) continue
      const name = select.value
      if (!name) continue
      const value = readRowValue(row)
      if (value !== undefined && value !== '') {
        filters[name] = value
      }
    }
    return filters
  }

  function readRowValue(row) {
    const range = row.querySelector('.field-range')
    if (range) {
      const inputs = range.querySelectorAll('input')
      const from = inputs[0]?.value || ''
      const to = inputs[1]?.value || ''
      if (!from && !to) return undefined
      const obj = {}
      if (from) obj.from = range.dataset.kind === 'date_range' ? from : Number(from)
      if (to) obj.to = range.dataset.kind === 'date_range' ? to : Number(to)
      return obj
    }
    const valueEl = row.querySelector('.field-value select, .field-value input')
    if (!valueEl) return undefined
    return valueEl.value
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    toggle()
  })

  addBtn.addEventListener('click', () => {
    appendRow(null, getDefinitions() || {}, getCurrentFilters() || {})
  })

  clearBtn.addEventListener('click', () => {
    rowsContainer.innerHTML = ''
    onApply({})
    close()
  })

  applyBtn.addEventListener('click', () => {
    const filters = collectFilters()
    onApply(filters)
    close()
  })

  return { open, close, toggle }
}
