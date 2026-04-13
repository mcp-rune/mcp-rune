/**
 * Shared filter chip rendering for search-view and list-view apps.
 *
 * Renders active filter chips and available filter hints from filter definitions.
 */

import { humanize, escapeHtml } from './helpers.js'

/**
 * Render active filter chips into a container element.
 *
 * @param {HTMLElement} container - DOM element to render chips into
 * @param {Object} filters - Active filter key-value pairs
 * @param {Object} definitions - Filter definitions with label/type metadata
 * @param {Object} [options]
 * @param {boolean} [options.append=false] - Append to existing content instead of clearing
 */
export function renderFilterChips(container, filters, definitions, { append = false } = {}) {
  const keys = Object.keys(filters)

  if (keys.length === 0) {
    if (!append) container.style.display = 'none'
    return
  }

  container.style.display = 'flex'
  if (!append) container.innerHTML = ''

  for (const name of keys) {
    const value = filters[name]
    const def = definitions[name] || {}
    const label = def.label || humanize(name)
    const displayValue = formatFilterValue(value, def)

    const chip = document.createElement('span')
    chip.className = 'filter-chip'
    chip.innerHTML =
      `<span class="chip-label">${escapeHtml(label)}:</span>` +
      `<span class="chip-value">${escapeHtml(displayValue)}</span>`

    container.appendChild(chip)
  }
}

/**
 * Render available (unused) filter hints below the chips.
 *
 * @param {HTMLElement} container - DOM element to render hint into
 * @param {Object} filters - Active filter key-value pairs
 * @param {Object} definitions - All filter definitions
 */
export function renderAvailableFilters(container, filters, definitions) {
  const activeKeys = new Set(Object.keys(filters))
  const available = Object.entries(definitions)
    .filter(([name]) => !activeKeys.has(name))
    .map(([name, def]) => def.label || humanize(name))

  if (available.length === 0) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'block'
  container.textContent = `More filters available: ${available.join(', ')}`
}

/**
 * Format a filter value for display in a chip.
 *
 * @param {*} value - Filter value (string, number, or range object)
 * @param {Object} definition - Filter definition with type metadata
 * @returns {string}
 */
export function formatFilterValue(value, definition) {
  if (Array.isArray(value)) {
    return value.map((v) => humanize(String(v))).join(', ')
  }

  if (typeof value === 'object' && value !== null) {
    return formatRangeValue(value, definition)
  }

  if (typeof value === 'string') {
    if (definition.type === 'text') return `"${value}"`
    return humanize(value)
  }

  return String(value)
}

/**
 * Format a range filter value (date ranges, numeric ranges).
 *
 * @param {Object} value - Range object with from/to or min/max keys
 * @param {Object} definition - Filter definition with type metadata
 * @returns {string}
 */
export function formatRangeValue(value, definition) {
  const isDate = definition.type === 'date_range'
  const fromKey = value.from !== undefined ? 'from' : value.min !== undefined ? 'min' : null
  const toKey = value.to !== undefined ? 'to' : value.max !== undefined ? 'max' : null

  const from = fromKey ? value[fromKey] : null
  const to = toKey ? value[toKey] : null

  if (from != null && to != null) return `${from} — ${to}`
  if (from != null) return isDate ? `from ${from}` : `≥ ${from}`
  if (to != null) return isDate ? `until ${to}` : `≤ ${to}`
  return '(any)'
}
