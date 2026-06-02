/**
 * Pick Record MCP App — Client-side
 *
 * Type-ahead search with debounced server calls and checkable result list.
 * Supports single-model search and cross-model group search.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { humanize, pluralize } from '../../shared/helpers.js'
import { initApp, showStatus, clearStatus } from '../../shared/app-init.js'
import { storeSelection } from '../../shared/selection.js'

// ─── State ──────────────────────────────────────────────────────────────────

let modelName = null
let searchFields = []
let currentResults = []
let maxLimit = 10
const selectedIds = new Map() // id → { display, entityType?, ...fields }
let requestCounter = 0
let debounceTimer = null

// Group mode state
let groupName = null
let groupLabel = null
let typeToModel = null
let currentContext = null // tracks model or group to detect context changes

// ─── MCP App Connection ─────────────────────────────────────────────────────

const app = new App({ name: 'Pick Record', version: '1.0.0' })

app.ontoolresult = (result) => {
  try {
    const textContent = result?.content?.find((c) => c.type === 'text')
    if (!textContent) return
    const data = JSON.parse(textContent.text)

    if (data.error) {
      showStatus(statusBar, data.error, 'error')
      return
    }

    // Detect context change and clear stale selections
    const newContext = data.model || data.group || null
    if (newContext !== currentContext) {
      selectedIds.clear()
      updateSelectionBar()
    }
    currentContext = newContext

    // Group mode response
    if (data.group) {
      groupName = data.group
      groupLabel = data.groupLabel
      typeToModel = data.typeToModel || null
      modelName = null
      searchFields = []
      maxLimit = data.limit || 10
      currentResults = data.results || []

      renderHeader()
      renderResults(currentResults)

      if (data.query) {
        document.getElementById('search-input').value = data.query
      }
      document.getElementById('search-input').focus()
      return
    }

    // Single-model response
    if (data.model && data.searchFields !== undefined) {
      modelName = data.model
      searchFields = data.searchFields || []
      groupName = null
      groupLabel = null
      typeToModel = null
      maxLimit = data.limit || 10
      currentResults = data.results || []

      renderHeader()
      renderResults(currentResults)

      if (data.query) {
        document.getElementById('search-input').value = data.query
      }
      document.getElementById('search-input').focus()
    }
  } catch {
    /* ignore parse errors */
  }
}

await app.connect()
initApp(app)

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderHeader() {
  if (groupName) {
    document.getElementById('title').textContent = `Search ${groupLabel || humanize(groupName)}`
    document.getElementById('subtitle').textContent = 'Search across all entity types'
  } else {
    const label = humanize(modelName)
    document.getElementById('title').textContent = `Search ${pluralize(label)}`
    document.getElementById('subtitle').textContent =
      `Search by ${searchFields.join(', ') || 'text'}`
  }
}

function renderResults(results) {
  const container = document.getElementById('results-container')

  if (results.length === 0) {
    const input = document.getElementById('search-input')
    container.innerHTML = input.value
      ? '<p class="empty-state">No results found</p>'
      : '<p class="empty-state">Type to search for records</p>'
    return
  }

  const ul = document.createElement('ul')
  ul.className = 'result-list'

  for (const result of results) {
    const li = document.createElement('li')
    li.className = 'result-item'
    if (selectedIds.has(String(result.id))) {
      li.classList.add('selected')
    }

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = selectedIds.has(String(result.id))
    cb.addEventListener('change', (e) => {
      e.stopPropagation()
      toggleSelection(result, e.target.checked)
      li.classList.toggle('selected', e.target.checked)
    })

    const info = document.createElement('div')
    info.className = 'result-info'

    // Entity type badge for group mode
    if (result.entityType) {
      const tag = document.createElement('span')
      tag.className = 'entity-type-tag'
      tag.textContent = humanize(result.entityType)
      info.appendChild(tag)
    }

    const display = document.createElement('div')
    display.className = 'result-display'
    display.textContent = result.display

    info.appendChild(display)

    // Show extra autocomplete fields as secondary text (skip entityType — already shown as badge)
    const extraFields = Object.entries(result)
      .filter(([k]) => k !== 'id' && k !== 'display' && k !== 'entityType')
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
      toggleSelection(result, cb.checked)
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

function toggleSelection(result, checked) {
  const id = String(result.id)
  if (checked) {
    selectedIds.set(id, result)
  } else {
    selectedIds.delete(id)
  }
  updateSelectionBar()
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

async function sendSelection() {
  if (selectedIds.size === 0) return

  if (groupName && typeToModel) {
    // Group mode: group selected IDs by entity type, send one selection per model key
    const byModel = new Map()
    for (const [id, result] of selectedIds) {
      const entityType = result.entityType
      const modelKey = typeToModel[entityType] || entityType
      if (!byModel.has(modelKey)) {
        byModel.set(modelKey, [])
      }
      byModel.get(modelKey).push(id)
    }

    // Send one selection per model key
    for (const [modelKey, ids] of byModel) {
      await storeSelection(app, statusBar, 'select_autocomplete_records', {
        model: modelKey,
        mode: 'ids',
        ids,
        total: ids.length
      })
    }
  } else {
    // Single-model mode
    await storeSelection(app, statusBar, 'select_autocomplete_records', {
      model: modelName,
      mode: 'ids',
      ids: [...selectedIds.keys()],
      total: selectedIds.size
    })
  }
}

// ─── Search ─────────────────────────────────────────────────────────────────

async function doSearch(query) {
  if (!modelName && !groupName) return

  const thisRequest = ++requestCounter
  clearStatus(statusBar)
  showStatus(statusBar, 'Searching…', 'info')

  const args = { query, limit: maxLimit }
  if (groupName) {
    args.group = groupName
  } else {
    args.model = modelName
  }

  try {
    const result = await app.callServerTool({
      name: 'pick_model_app',
      arguments: args
    })

    // Ignore stale responses
    if (thisRequest !== requestCounter) return

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

    currentResults = data.results || []
    renderResults(currentResults)
    clearStatus(statusBar)
  } catch (err) {
    if (thisRequest === requestCounter) {
      showStatus(statusBar, 'Error: ' + err.message, 'error')
    }
  }
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

document.getElementById('search-input').addEventListener('input', (e) => {
  const query = e.target.value.trim()

  if (debounceTimer) clearTimeout(debounceTimer)

  if (!query) {
    currentResults = []
    renderResults([])
    clearStatus(statusBar)
    return
  }

  debounceTimer = setTimeout(() => doSearch(query), 300)
})

document.getElementById('btn-send-selection').addEventListener('click', sendSelection)

// ─── Helpers ────────────────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar')
