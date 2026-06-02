/**
 * Multi-Pick Records MCP App — Client-side
 *
 * All records loaded upfront, instant client-side text filter, checkable list.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { humanize } from '../../shared/helpers.js'
import { initApp, showStatus } from '../../shared/app-init.js'
import { storeSelection } from '../../shared/selection.js'

// ─── State ──────────────────────────────────────────────────────────────────

let modelName = null
let allRecords = []
const selectedIds = new Map() // id → { display, ...fields }

// ─── MCP App Connection ─────────────────────────────────────────────────────

const app = new App({ name: 'Multi-Pick Records', version: '1.0.0' })

app.ontoolresult = (result) => {
  try {
    const textContent = result?.content?.find((c) => c.type === 'text')
    if (!textContent) return
    const data = JSON.parse(textContent.text)

    if (data.error) {
      showStatus(statusBar, data.error, 'error')
      return
    }

    if (data.model && data.records !== undefined) {
      modelName = data.model
      allRecords = data.records || []

      renderHeader()
      renderResults()
      document.getElementById('filter-input').focus()
    }
  } catch {
    /* ignore parse errors */
  }
}

await app.connect()
initApp(app)

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderHeader() {
  const label = humanize(modelName)
  document.getElementById('title').textContent = `Select ${label}s`
  document.getElementById('subtitle').textContent = `${allRecords.length} records available`
}

function renderResults() {
  const container = document.getElementById('results-container')

  if (allRecords.length === 0) {
    container.innerHTML = '<div class="mr-empty">No records available</div>'
    return
  }

  const list = document.createElement('div')
  list.className = 'mr-results'
  list.id = 'result-list'

  for (const record of allRecords) {
    const row = document.createElement('div')
    row.className = 'mr-result'
    row.dataset.id = record.id
    row.dataset.searchText = record.display.toLowerCase()
    if (selectedIds.has(String(record.id))) {
      row.classList.add('active')
    }

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'mr-check'
    cb.checked = selectedIds.has(String(record.id))
    cb.addEventListener('change', (e) => {
      e.stopPropagation()
      toggleSelection(record, e.target.checked)
      row.classList.toggle('active', e.target.checked)
    })
    row.appendChild(cb)

    const mark = document.createElement('span')
    mark.className = 'rmark'
    mark.textContent =
      record.display
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 2)
        .toUpperCase() || '?'
    row.appendChild(mark)

    const body = document.createElement('span')
    body.className = 'rbody'

    const display = document.createElement('span')
    display.className = 'rname'
    display.textContent = record.display
    body.appendChild(display)

    const extraFields = Object.entries(record)
      .filter(([k]) => k !== 'id' && k !== 'display')
      .map(([k, v]) => `${humanize(k)}: ${v}`)
      .join(' · ')

    if (extraFields) {
      const fields = document.createElement('span')
      fields.className = 'rmeta'
      fields.textContent = extraFields
      body.appendChild(fields)
    }

    row.appendChild(body)

    row.addEventListener('click', (e) => {
      if (e.target === cb) return
      cb.checked = !cb.checked
      toggleSelection(record, cb.checked)
      row.classList.toggle('active', cb.checked)
    })

    list.appendChild(row)
  }

  container.innerHTML = ''
  container.appendChild(list)
}

// ─── Selection ──────────────────────────────────────────────────────────────

function toggleSelection(record, checked) {
  const id = String(record.id)
  if (checked) {
    selectedIds.set(id, record)
  } else {
    selectedIds.delete(id)
  }
  updateSelectionBar()
  updateSelectAllCheckbox()
}

function updateSelectionBar() {
  const info = document.getElementById('selection-info')
  const sendBtn = document.getElementById('btn-send-selection')

  if (selectedIds.size > 0) {
    info.style.display = 'inline'
    sendBtn.style.visibility = 'visible'
    document.getElementById('selection-count').textContent = `${selectedIds.size} selected`
  } else {
    info.style.display = 'none'
    sendBtn.style.visibility = 'hidden'
  }
}

function updateSelectAllCheckbox() {
  const selectAll = document.getElementById('select-all')
  const visibleItems = getVisibleItems()
  if (visibleItems.length === 0) {
    selectAll.checked = false
    selectAll.indeterminate = false
    return
  }
  const allChecked = visibleItems.every((li) => selectedIds.has(li.dataset.id))
  const someChecked = visibleItems.some((li) => selectedIds.has(li.dataset.id))
  selectAll.checked = allChecked
  selectAll.indeterminate = someChecked && !allChecked
}

function toggleSelectAll(checked) {
  const visibleItems = getVisibleItems()
  for (const li of visibleItems) {
    const id = li.dataset.id
    const cb = li.querySelector('input[type="checkbox"]')
    cb.checked = checked

    if (checked) {
      const record = allRecords.find((r) => String(r.id) === id)
      if (record) selectedIds.set(id, record)
    } else {
      selectedIds.delete(id)
    }
    li.classList.toggle('active', checked)
  }
  updateSelectionBar()
}

function getVisibleItems() {
  return [...document.querySelectorAll('.mr-result:not(.hidden)')]
}

async function sendSelection() {
  if (selectedIds.size === 0) return
  await storeSelection(app, statusBar, 'select_multi_records', {
    model: modelName,
    mode: 'ids',
    ids: [...selectedIds.keys()],
    total: selectedIds.size
  })
}

// ─── Client-Side Filter ─────────────────────────────────────────────────────

function applyFilter(query) {
  const items = document.querySelectorAll('.mr-result')
  const lower = query.toLowerCase()

  for (const li of items) {
    const matches = !lower || li.dataset.searchText.includes(lower)
    li.classList.toggle('hidden', !matches)
  }

  updateSelectAllCheckbox()
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

document.getElementById('filter-input').addEventListener('input', (e) => {
  applyFilter(e.target.value.trim())
})

document.getElementById('select-all').addEventListener('change', (e) => {
  toggleSelectAll(e.target.checked)
})

document.getElementById('btn-send-selection').addEventListener('click', sendSelection)

// ─── Helpers ────────────────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar')
