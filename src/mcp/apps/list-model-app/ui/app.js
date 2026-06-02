/**
 * List View MCP App — Client-side
 *
 * Renders a browseable table of records from a schema received via the MCP Apps protocol.
 * Supports pagination, row selection with checkboxes, and clicking a row to open the edit form.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { initApp, showStatus, clearStatus } from '../../shared/app-init.js'
import { renderFilterChips, renderAvailableFilters } from '../../shared/filter-chips.js'
import { createTableSelection } from '../../shared/selection.js'
import { renderCellValue } from '../../shared/formatters.js'
import '../../shared/formatters.runtime.js'

// ─── State ──────────────────────────────────────────────────────────────────

let listSchema = null
let currentRecords = []
let currentPage = 1
let modelName = null
let activeFilters = {}
let filterDefinitions = {}
let currentPagination = null

// ─── MCP App Connection ─────────────────────────────────────────────────────

const app = new App({ name: 'List Records', version: '1.0.0' })

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
      activeFilters = data.activeFilters || {}
      filterDefinitions = data.filterDefinitions || {}
      currentPagination = data.pagination || null

      renderHeader(data.schema)
      renderFilterChips(document.getElementById('filter-chips'), activeFilters, filterDefinitions)
      renderAvailableFilters(
        document.getElementById('available-filters'),
        activeFilters,
        filterDefinitions
      )
      renderTable(data.schema, currentRecords)
      renderPagination(data.pagination)
    }
  } catch {
    /* ignore parse errors */
  }
}

await app.connect()
initApp(app)

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderHeader(schema) {
  document.getElementById('list-title').textContent = schema.title
}

function renderTable(schema, records) {
  const container = document.getElementById('table-container')

  selection.clear()

  if (records.length === 0) {
    container.innerHTML = '<div class="mr-empty">No records found</div>'
    return
  }

  const table = document.createElement('table')
  table.className = 'mr-table'

  // Header
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

  // Body
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

    // Click to open edit form
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

// ─── Actions ────────────────────────────────────────────────────────────────

async function fetchPage(page) {
  if (!modelName) return
  clearStatus(statusBar)
  showStatus(statusBar, 'Loading…', 'info')

  try {
    const args = { model: modelName, page }
    if (Object.keys(activeFilters).length > 0) args.filters = activeFilters
    const result = await app.callServerTool({
      name: 'list_model_app',
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
    activeFilters = data.activeFilters || activeFilters

    renderFilterChips(document.getElementById('filter-chips'), activeFilters, filterDefinitions)
    renderAvailableFilters(
      document.getElementById('available-filters'),
      activeFilters,
      filterDefinitions
    )
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
    // If update form tool doesn't exist, try find_records as fallback
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

// ─── Event Handlers ─────────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar')

const selection = createTableSelection({
  app,
  statusBar,
  selectToolName: 'select_list_records',
  getState: () => ({ modelName, currentRecords, currentPagination, activeFilters })
})

document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentPage > 1) fetchPage(currentPage - 1)
})

document.getElementById('btn-next').addEventListener('click', () => {
  fetchPage(currentPage + 1)
})

document.getElementById('btn-send-selection').addEventListener('click', () => selection.send())

document.getElementById('btn-select-all-results').addEventListener('click', (e) => {
  e.preventDefault()
  selection.selectAllResults()
})
