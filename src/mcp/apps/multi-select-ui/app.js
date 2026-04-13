/**
 * Multi-Select Picker MCP App — Client-side
 *
 * All records loaded upfront, instant client-side text filter, checkable list.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { humanize } from '../shared/helpers.js'
import { initApp, showStatus } from '../shared/app-init.js'
import { storeSelection } from '../shared/selection.js'

// ─── State ──────────────────────────────────────────────────────────────────

let modelName = null
let allRecords = []
const selectedIds = new Map() // id → { display, ...fields }

// ─── MCP App Connection ─────────────────────────────────────────────────────

const app = new App({ name: 'Multi-Select Picker', version: '1.0.0' })

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
    container.innerHTML = '<p class="empty-state">No records available</p>'
    return
  }

  const ul = document.createElement('ul')
  ul.className = 'result-list'
  ul.id = 'result-list'

  for (const record of allRecords) {
    const li = document.createElement('li')
    li.className = 'result-item'
    li.dataset.id = record.id
    li.dataset.searchText = record.display.toLowerCase()
    if (selectedIds.has(String(record.id))) {
      li.classList.add('selected')
    }

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = selectedIds.has(String(record.id))
    cb.addEventListener('change', (e) => {
      e.stopPropagation()
      toggleSelection(record, e.target.checked)
      li.classList.toggle('selected', e.target.checked)
    })

    const info = document.createElement('div')
    info.className = 'result-info'

    const display = document.createElement('div')
    display.className = 'result-display'
    display.textContent = record.display

    info.appendChild(display)

    const extraFields = Object.entries(record)
      .filter(([k]) => k !== 'id' && k !== 'display')
      .map(([k, v]) => `${humanize(k)}: ${v}`)
      .join(' · ')

    if (extraFields) {
      const fields = document.createElement('div')
      fields.className = 'result-fields'
      fields.textContent = extraFields
      info.appendChild(fields)
    }

    li.addEventListener('click', (e) => {
      if (e.target === cb) return
      cb.checked = !cb.checked
      toggleSelection(record, cb.checked)
      li.classList.toggle('selected', cb.checked)
    })

    li.appendChild(cb)
    li.appendChild(info)
    ul.appendChild(li)
  }

  container.innerHTML = ''
  container.appendChild(ul)
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
    li.classList.toggle('selected', checked)
  }
  updateSelectionBar()
}

function getVisibleItems() {
  return [...document.querySelectorAll('.result-item:not(.hidden)')]
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
  const items = document.querySelectorAll('.result-item')
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
