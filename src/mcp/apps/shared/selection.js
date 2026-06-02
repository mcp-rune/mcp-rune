/**
 * Shared selection logic for MCP Apps.
 *
 * Centralizes the "store selection on server + show status feedback" pattern
 * used by all selection-enabled apps (find-model-app, pick-model-app,
 * multi-pick-model-app, view-selection-app). Also provides a table-selection
 * factory that encapsulates the full selection state management for paginated
 * table apps (find-model-app, view-selection-app).
 */

import { humanize, pluralize } from './helpers.js'
import { showStatus } from './app-init.js'

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Store selection on the server and show status feedback.
 *
 * This is the single place that handles the server tool call + user-facing
 * status message for all selection-enabled apps. The server-side selection
 * tool response includes a `message` field for LLM feedback.
 *
 * @param {Object} app - MCP App instance
 * @param {HTMLElement} statusBar - Status bar element
 * @param {string} selectToolName - Server-side select tool name
 * @param {Object} args - Selection args (model, mode, ids/filters, total, strategy)
 */
export async function storeSelection(app, statusBar, selectToolName, args) {
  try {
    const result = await app.callServerTool({ name: selectToolName, arguments: args })
    if (result?.isError) {
      const errText = result.content?.find((c) => c.type === 'text')?.text || 'Unknown error'
      showStatus(statusBar, errText, 'error')
      return
    }
  } catch (err) {
    showStatus(statusBar, 'Failed to save selection: ' + err.message, 'error')
    return
  }

  const total = args.total
  const modelLabel = args.model ? humanize(args.model) : 'record'
  const pluralLabel = total !== 1 ? pluralize(modelLabel) : modelLabel
  const verb = args.strategy === 'add' ? 'added to selection' : 'selected'
  showStatus(statusBar, `${total} ${pluralLabel} ${verb}`, 'success')
}

// ─── Table Selection Factory ─────────────────────────────────────────────────

/**
 * Create a table selection controller for paginated table apps.
 *
 * Encapsulates all selection state (selectedIds Set, allResultsSelected flag)
 * and DOM updates (selection bar, escalation banner, select-all checkbox).
 * The app provides a `getState()` callback so the controller always reads
 * fresh data without maintaining duplicate state.
 *
 * @param {Object} options
 * @param {Object} options.app - MCP App instance
 * @param {HTMLElement} options.statusBar - Status bar element
 * @param {string} options.selectToolName - Server-side select tool name
 * @param {Function} options.getState - Returns { modelName, currentRecords, currentPagination, activeFilters }
 */
export function createTableSelection({ app, statusBar, selectToolName, getState }) {
  const selectedIds = new Set()
  let allResultsSelected = false

  function clear() {
    selectedIds.clear()
    allResultsSelected = false
    updateBar()
  }

  function toggleRecord(id, checked) {
    const key = String(id)
    if (checked) {
      selectedIds.add(key)
    } else {
      selectedIds.delete(key)
      if (allResultsSelected) allResultsSelected = false
    }
    const row = document.querySelector(`tbody tr[data-id="${id}"]`)
    if (row) row.classList.toggle('sel', checked)
    updateBar()
    updateCheckbox()
  }

  function toggleAll(checked) {
    const checkboxes = document.querySelectorAll('tbody td.check input[type="checkbox"]')
    for (const cb of checkboxes) {
      const id = cb.dataset.id
      cb.checked = checked
      if (checked) {
        selectedIds.add(id)
      } else {
        selectedIds.delete(id)
      }
      const row = cb.closest('tr')
      if (row) row.classList.toggle('sel', checked)
    }

    if (!checked) allResultsSelected = false
    updateBar()
  }

  function updateBar() {
    const { currentRecords, currentPagination } = getState()
    const info = document.getElementById('selection-info')
    const sendGroup = document.getElementById('send-selection-group')
    const addBtn = document.getElementById('btn-send-add')
    const banner = document.getElementById('select-all-banner')
    const totalCount = document.getElementById('total-results-count')

    if (selectedIds.size > 0 || allResultsSelected) {
      info.style.display = 'inline'
      if (sendGroup) sendGroup.style.visibility = 'visible'

      if (allResultsSelected) {
        const total = currentPagination?.total || selectedIds.size
        document.getElementById('selection-count').textContent = `All ${total} selected`
        banner.style.display = 'none'
        if (addBtn) addBtn.style.display = 'none'
      } else {
        document.getElementById('selection-count').textContent = `${selectedIds.size} selected`
        if (addBtn) addBtn.style.display = ''

        const allOnPageSelected =
          selectedIds.size === currentRecords.length && currentRecords.length > 0
        const moreResultsExist = currentPagination?.total > currentRecords.length
        if (allOnPageSelected && moreResultsExist) {
          totalCount.textContent = currentPagination.total
          banner.style.display = 'inline'
        } else {
          banner.style.display = 'none'
        }
      }
    } else {
      info.style.display = 'none'
      if (sendGroup) sendGroup.style.visibility = 'hidden'
      banner.style.display = 'none'
    }
  }

  function updateCheckbox() {
    const selectAll = document.getElementById('select-all')
    if (!selectAll) return
    const total = document.querySelectorAll('tbody td.check input[type="checkbox"]').length
    if (total === 0) return
    selectAll.checked = selectedIds.size === total
    selectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < total
  }

  function selectAllResults() {
    allResultsSelected = true
    updateBar()
  }

  /**
   * Submit the current selection to the server.
   *
   * @param {'replace' | 'add'} [strategy='replace'] — how to combine with the
   *   stored selection for this model. 'add' is rejected by the server when
   *   either side is filter-mode; callers should hide the "Add" button under
   *   those conditions to keep the UX honest.
   */
  async function send(strategy = 'replace') {
    if (selectedIds.size === 0 && !allResultsSelected) return

    const { modelName, activeFilters, currentPagination } = getState()
    const args = { model: modelName, strategy }
    if (allResultsSelected) {
      args.mode = 'filter'
      args.filters = { ...activeFilters }
      args.total = currentPagination?.total || selectedIds.size
    } else {
      args.mode = 'ids'
      args.ids = [...selectedIds]
      args.total = selectedIds.size
    }

    await storeSelection(app, statusBar, selectToolName, args)
  }

  return { clear, toggleRecord, toggleAll, selectAllResults, send }
}
