/**
 * Find Model MCP App — Client-side
 *
 * Single browseable surface for "show me records of X" with optional
 * text query, structured filters, columns, and pagination. Selection
 * sends with explicit Replace vs Add strategy.
 *
 * The interactive filter editor lives in shared/filter-popover.js; this
 * module wires it to the title-bar Filters button and re-issues the
 * find_model_app tool call whenever filters change.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { escapeHtml } from '../../shared/helpers.js'
import { initApp, showStatus, clearStatus } from '../../shared/app-init.js'
import { renderFilterChips } from '../../shared/filter-chips.js'
import { createFilterPopover } from '../../shared/filter-popover.js'
import { createTableSelection } from '../../shared/selection.js'
import { renderCellValue } from '../../shared/formatters.js'
import '../../shared/formatters.runtime.js'

let listSchema = null
let currentRecords = []
let currentPage = 1
let modelName = null
let currentQuery = null
let activeFilters = {}
let filterDefinitions = {}
let currentPagination = null

const app = new App({ name: 'Find Records', version: '1.0.0' })

app.ontoolresult = (result) => {
  try {
    const textContent = result?.content?.find((c) => c.type === 'text')
    if (!textContent) return
    const data = JSON.parse(textContent.text)

    if (data.error) {
      showStatus(statusBar, data.error, 'error')
      return
    }

    if (data.schema) {
      listSchema = data.schema
      modelName = data.schema.model
      currentRecords = data.records || []
      currentPage = data.pagination?.page || 1
      currentQuery = data.query || null
      activeFilters = data.activeFilters || {}
      filterDefinitions = data.filterDefinitions || {}
      currentPagination = data.pagination || null

      renderHeader(data.schema)
      renderChips()
      updateFilterButton()
      renderTable(data.schema, currentRecords)
      renderPagination(data.pagination)
    }
  } catch {
    /* ignore parse errors */
  }
}

await app.connect()
initApp(app)

function renderHeader(schema) {
  document.getElementById('list-title').textContent = schema.title
}

function renderChips() {
  const container = document.getElementById('filter-chips')
  const hasQuery = currentQuery && currentQuery.trim().length > 0
  const hasFilters = Object.keys(activeFilters).length > 0

  if (!hasQuery && !hasFilters) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'flex'
  container.innerHTML = ''

  if (hasQuery) {
    const chip = document.createElement('span')
    chip.className = 'mr-badge acc'
    chip.innerHTML =
      `<span class="k">Search:</span> ` + `<span class="v">${escapeHtml(currentQuery)}</span>`
    container.appendChild(chip)
  }

  renderFilterChips(container, activeFilters, filterDefinitions, { append: true })
}

function updateFilterButton() {
  const badge = document.getElementById('filter-count-badge')
  const count = Object.keys(activeFilters).length
  if (count > 0) {
    badge.textContent = String(count)
    badge.style.display = 'inline'
  } else {
    badge.style.display = 'none'
  }
}

function renderTable(schema, records) {
  const container = document.getElementById('table-container')

  selection.clear()

  if (records.length === 0) {
    container.innerHTML = '<div class="mr-empty">No records match the current filters</div>'
    return
  }

  const table = document.createElement('table')
  table.className = 'mr-table'

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')

  const selectAllTh = document.createElement('th')
  selectAllTh.className = 'check'
  const selectAllCb = document.createElement('input')
  selectAllCb.type = 'checkbox'
  selectAllCb.id = 'select-all'
  selectAllCb.className = 'mr-check'
  selectAllCb.addEventListener('change', (e) => selection.toggleAll(e.target.checked))
  selectAllTh.appendChild(selectAllCb)
  headerRow.appendChild(selectAllTh)

  for (const col of schema.columns) {
    const th = document.createElement('th')
    th.textContent = col.label
    headerRow.appendChild(th)
  }
  thead.appendChild(headerRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const record of records) {
    const tr = document.createElement('tr')
    tr.dataset.id = record.id

    const cbTd = document.createElement('td')
    cbTd.className = 'check'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'mr-check'
    cb.dataset.id = record.id
    cb.addEventListener('change', (e) => {
      selection.toggleRecord(record.id, e.target.checked)
    })
    cbTd.addEventListener('click', (e) => e.stopPropagation())
    cbTd.appendChild(cb)
    tr.appendChild(cbTd)

    for (const col of schema.columns) {
      const td = document.createElement('td')
      td.appendChild(renderCellValue(record[col.name], col))
      tr.appendChild(td)
    }

    tr.addEventListener('click', () => {
      openEditForm(record.id)
    })

    tbody.appendChild(tr)
  }
  table.appendChild(tbody)

  container.innerHTML = ''
  container.appendChild(table)
}

function renderPagination(pagination) {
  if (!pagination) return
  const container = document.getElementById('pagination')
  container.style.display = 'flex'

  const total = pagination.total || 0
  const perPage = pagination.per_page || 20
  const totalPages = Math.ceil(total / perPage) || 1

  const pageInfo = document.getElementById('page-info')
  pageInfo.innerHTML =
    total > 0
      ? `Page <b>${currentPage}</b> of <b>${totalPages}</b> · ${total} records`
      : `Page <b>${currentPage}</b>`

  document.getElementById('btn-prev').disabled = currentPage <= 1
  document.getElementById('btn-next').disabled = currentPage >= totalPages
}

async function fetchPage(page, overrides = {}) {
  if (!modelName) return
  clearStatus(statusBar)
  showStatus(statusBar, 'Loading…', 'info')

  const nextFilters = overrides.filters ?? activeFilters
  const nextQuery = overrides.query !== undefined ? overrides.query : currentQuery

  try {
    const args = { model: modelName, page }
    if (nextQuery) args.query = nextQuery
    if (Object.keys(nextFilters).length > 0) args.filters = nextFilters

    const result = await app.callServerTool({
      name: 'find_model_app',
      arguments: args
    })

    if (result?.isError) {
      const errText = result.content?.find((c) => c.type === 'text')?.text || 'Unknown error'
      showStatus(statusBar, errText, 'error')
      return
    }

    const text = result?.content?.find((c) => c.type === 'text')?.text
    if (!text) return

    const data = JSON.parse(text)
    if (data.error) {
      showStatus(statusBar, data.error, 'error')
      return
    }

    currentRecords = data.records || []
    currentPage = data.pagination?.page || page
    currentPagination = data.pagination || null
    currentQuery = data.query ?? nextQuery
    activeFilters = data.activeFilters ?? nextFilters

    renderChips()
    updateFilterButton()
    renderTable(listSchema, currentRecords)
    renderPagination(data.pagination)
    clearStatus(statusBar)
  } catch (err) {
    showStatus(statusBar, 'Error: ' + err.message, 'error')
  }
}

async function openEditForm(recordId) {
  if (!modelName) return

  try {
    await app.callServerTool({
      name: 'edit_model_app',
      arguments: { model: modelName, record_id: String(recordId) }
    })
  } catch {
    try {
      await app.callServerTool({
        name: 'find_records',
        arguments: { model: modelName, record_id: String(recordId) }
      })
    } catch (err) {
      showStatus(statusBar, 'Error opening record: ' + err.message, 'error')
    }
  }
}

const statusBar = document.getElementById('status-bar')

const selection = createTableSelection({
  app,
  statusBar,
  selectToolName: 'select_find_records',
  getState: () => ({ modelName, currentRecords, currentPagination, activeFilters })
})

const popover = createFilterPopover({
  trigger: document.getElementById('btn-filters'),
  panel: document.getElementById('filter-popover'),
  rowsContainer: document.getElementById('filter-rows'),
  addBtn: document.getElementById('btn-add-filter'),
  clearBtn: document.getElementById('btn-clear-filters'),
  applyBtn: document.getElementById('btn-apply-filters'),
  getDefinitions: () => filterDefinitions,
  getCurrentFilters: () => activeFilters,
  onApply: (filters) => {
    activeFilters = filters
    fetchPage(1, { filters })
  }
})

document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentPage > 1) fetchPage(currentPage - 1)
})

document.getElementById('btn-next').addEventListener('click', () => {
  fetchPage(currentPage + 1)
})

document
  .getElementById('btn-send-replace')
  .addEventListener('click', () => selection.send('replace'))
document.getElementById('btn-send-add').addEventListener('click', () => selection.send('add'))

document.getElementById('btn-select-all-results').addEventListener('click', (e) => {
  e.preventDefault()
  selection.selectAllResults()
})

// Hide popover when clicking outside it.
document.addEventListener('click', (e) => {
  const panel = document.getElementById('filter-popover')
  const trigger = document.getElementById('btn-filters')
  if (panel.style.display === 'none') return
  if (panel.contains(e.target) || trigger.contains(e.target)) return
  popover.close()
})
