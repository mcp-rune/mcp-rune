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
      ? '<div class="mr-empty">No results found</div>'
      : '<div class="mr-empty">Type to search for records</div>'
    return
  }

  const list = document.createElement('div')
  list.className = 'mr-results'

  for (const result of results) {
    const row = document.createElement('div')
    row.className = 'mr-result'
    if (selectedIds.has(String(result.id))) {
      row.classList.add('active')
    }

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'mr-check'
    cb.checked = selectedIds.has(String(result.id))
    cb.addEventListener('change', (e) => {
      e.stopPropagation()
      toggleSelection(result, e.target.checked)
      row.classList.toggle('active', e.target.checked)
    })
    row.appendChild(cb)

    // Initials avatar — uses entityType in group mode, otherwise first letters of display.
    const mark = document.createElement('span')
    mark.className = 'rmark'
    const seed = result.entityType || result.display || '?'
    mark.textContent =
      seed
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 2)
        .toUpperCase() || '?'
    row.appendChild(mark)

    const body = document.createElement('span')
    body.className = 'rbody'

    if (result.entityType) {
      const tag = document.createElement('span')
      tag.className = 'mr-badge neutral'
      tag.style.marginRight = '6px'
      tag.textContent = humanize(result.entityType)
      body.appendChild(tag)
    }

    const display = document.createElement('span')
    display.className = 'rname'
    display.textContent = result.display
    body.appendChild(display)

    const extraFields = Object.entries(result)
      .filter(([k]) => k !== 'id' && k !== 'display' && k !== 'entityType')
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
      toggleSelection(result, cb.checked)
      row.classList.toggle('active', cb.checked)
    })

    list.appendChild(row)
  }

  container.innerHTML = ''
  container.appendChild(list)
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
