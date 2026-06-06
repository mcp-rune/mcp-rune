/**
 * View Selection MCP App — Client-side
 *
 * Renders one of three views based on payload.view:
 *   - 'summary' (no model): list every active selection.
 *   - 'ids'     (ids-mode): table with per-row × that calls remove_from_selection.
 *   - 'filter'  (filter-mode): filter chips + "Materialize as IDs" button.
 *
 * Selection-management actions (remove, clear, materialize) call the
 * model-visible shared tools registered alongside this app, then
 * re-invoke view_selection_app to refresh.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { humanize } from '../../shared/helpers.js'
import { initApp, showStatus, clearStatus } from '../../shared/app-init.js'
import { renderFilterChips } from '../../shared/filter-chips.js'
import { renderCellValue } from '../../shared/kind-renderers.js'
import '../../shared/kind-renderers.runtime.js'

let currentModel = null
let currentSchema = null
let currentRecords = []
let currentFilters = {}
let filterDefinitions = {}
let currentView = null
let currentTotal = 0

const app = new App({ name: 'View Selection', version: '1.0.0' })

app.ontoolresult = (result) => {
  try {
    const textContent = result?.content?.find((c) => c.type === 'text')
    if (!textContent) return
    const data = JSON.parse(textContent.text)
    if (data.error) {
      showStatus(statusBar, data.error, 'error')
      return
    }
    render(data)
  } catch {
    /* ignore parse errors */
  }
}

await app.connect()
initApp(app)

function render(data) {
  currentView = data.view
  currentModel = data.model || null
  currentSchema = data.schema || null
  filterDefinitions = data.filterDefinitions || {}

  const titleEl = document.getElementById('view-title')
  const clearBtn = document.getElementById('btn-clear')
  const materializeBtn = document.getElementById('btn-materialize')
  const chipsEl = document.getElementById('filter-chips')
  const metaEl = document.getElementById('selection-meta')

  // Reset shared controls per render — only the active view re-enables them.
  clearBtn.style.display = 'none'
  materializeBtn.style.display = 'none'
  chipsEl.style.display = 'none'
  metaEl.style.display = 'none'

  if (currentView === 'summary') {
    titleEl.textContent = 'Current selections'
    renderSummary(data.selections || [])
    return
  }

  if (currentView === 'empty') {
    titleEl.textContent = `${humanize(currentModel)} selection`
    document.getElementById('table-container').innerHTML =
      '<div class="mr-empty">No records currently selected. Use find_model_app to start a selection.</div>'
    return
  }

  if (currentView === 'filter') {
    currentFilters = data.filters || {}
    currentTotal = data.total || 0
    titleEl.textContent = `${humanize(currentModel)} selection (filter-mode)`
    clearBtn.style.display = ''
    materializeBtn.style.display = ''
    chipsEl.style.display = 'flex'
    renderFilterChips(chipsEl, currentFilters, filterDefinitions)
    metaEl.style.display = 'block'
    metaEl.textContent = `${currentTotal} record(s) match. Materialize to prune individual rows.`
    document.getElementById('table-container').innerHTML = ''
    return
  }

  if (currentView === 'ids') {
    currentRecords = data.records || []
    currentTotal = data.total || currentRecords.length
    titleEl.textContent = `${humanize(currentModel)} selection`
    clearBtn.style.display = ''
    metaEl.style.display = 'block'
    metaEl.textContent = `${currentTotal} record(s) selected.`
    renderTable(currentSchema, currentRecords)
  }
}

function renderSummary(selections) {
  const container = document.getElementById('table-container')
  container.innerHTML = ''

  if (selections.length === 0) {
    container.innerHTML = '<div class="mr-empty">No active selections.</div>'
    return
  }

  const card = document.createElement('div')
  card.className = 'mr-summary-card'

  const heading = document.createElement('h2')
  heading.textContent = `${selections.length} active selection(s)`
  card.appendChild(heading)

  const ul = document.createElement('ul')
  ul.className = 'mr-summary-list'
  for (const s of selections) {
    const li = document.createElement('li')
    const modelSpan = document.createElement('span')
    modelSpan.className = 'model'
    modelSpan.textContent = humanize(s.model)
    const metaSpan = document.createElement('span')
    metaSpan.className = 'meta'
    metaSpan.textContent = `${s.mode} · ${s.total} record(s)`
    const openBtn = document.createElement('button')
    openBtn.type = 'button'
    openBtn.className = 'mr-btn ghost'
    openBtn.textContent = 'Open'
    openBtn.addEventListener('click', () => {
      refresh({ model: s.model })
    })

    li.appendChild(modelSpan)
    li.appendChild(metaSpan)
    li.appendChild(openBtn)
    ul.appendChild(li)
  }
  card.appendChild(ul)
  container.appendChild(card)
}

function renderTable(schema, records) {
  const container = document.getElementById('table-container')

  if (!schema || records.length === 0) {
    container.innerHTML = '<div class="mr-empty">No records.</div>'
    return
  }

  const table = document.createElement('table')
  table.className = 'mr-table'

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  for (const col of schema.columns) {
    const th = document.createElement('th')
    th.textContent = col.label
    headerRow.appendChild(th)
  }
  const actionTh = document.createElement('th')
  actionTh.className = 'remove'
  headerRow.appendChild(actionTh)
  thead.appendChild(headerRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const record of records) {
    const tr = document.createElement('tr')
    tr.dataset.id = record.id

    for (const col of schema.columns) {
      const td = document.createElement('td')
      td.appendChild(renderCellValue(record[col.name], col))
      tr.appendChild(td)
    }

    const removeTd = document.createElement('td')
    removeTd.className = 'remove'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn-remove'
    btn.textContent = '×'
    btn.title = 'Remove from selection'
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      tr.classList.add('removing')
      await callShared('remove_from_selection', {
        model: currentModel,
        ids: [String(record.id)]
      })
      await refresh({ model: currentModel })
    })
    removeTd.appendChild(btn)
    tr.appendChild(removeTd)

    tbody.appendChild(tr)
  }
  table.appendChild(tbody)

  container.innerHTML = ''
  container.appendChild(table)
}

async function callShared(name, args) {
  try {
    const result = await app.callServerTool({ name, arguments: args })
    if (result?.isError) {
      const errText = result.content?.find((c) => c.type === 'text')?.text || 'Unknown error'
      showStatus(statusBar, errText, 'error')
      return null
    }
    return result
  } catch (err) {
    showStatus(statusBar, 'Error: ' + err.message, 'error')
    return null
  }
}

async function refresh(args) {
  clearStatus(statusBar)
  await app.callServerTool({ name: 'view_selection_app', arguments: args })
}

const statusBar = document.getElementById('status-bar')

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!currentModel) return
  await callShared('clear_selection', { model: currentModel })
  await refresh({ model: currentModel })
})

document.getElementById('btn-materialize').addEventListener('click', async () => {
  if (!currentModel) return
  showStatus(statusBar, 'Materializing…', 'info')
  await callShared('materialize_selection', { model: currentModel })
  await refresh({ model: currentModel })
})
