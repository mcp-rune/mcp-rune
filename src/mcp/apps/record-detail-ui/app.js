/**
 * Record Detail MCP App — Client-side
 *
 * Renders read-only detail cards for one or more records from a schema
 * received via the MCP Apps protocol.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { pluralize } from '../shared/helpers.js'
import { initApp, showStatus } from '../shared/app-init.js'
import { renderCellValue } from '../shared/formatters.js'
import '../shared/formatters.runtime.js'

// ─── MCP App Connection ─────────────────────────────────────────────────────

const app = new App({ name: 'Record Detail', version: '1.0.0' })

app.ontoolresult = (result) => {
  try {
    const textContent = result?.content?.find((c) => c.type === 'text')
    if (!textContent) return
    const data = JSON.parse(textContent.text)

    if (data.error) {
      showStatus(statusBar, data.error, 'error')
      return
    }

    if (data.schema && data.records) {
      renderRecords(data.schema, data.records, data.cappedMessage)
    }
  } catch {
    /* ignore parse errors */
  }
}

await app.connect()
initApp(app)

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderRecords(schema, records, cappedMessage) {
  const isMulti = records.length > 1
  const titleEl = document.getElementById('detail-title')
  titleEl.textContent = isMulti ? pluralize(schema.title) + ' Details' : schema.title + ' Detail'

  const container = document.getElementById('detail-container')
  container.innerHTML = ''

  if (cappedMessage) {
    const cap = document.createElement('p')
    cap.className = 'capped-message'
    cap.textContent = cappedMessage
    container.appendChild(cap)
  }

  if (records.length === 0) {
    container.innerHTML = '<p class="empty-state">No records found</p>'
    return
  }

  for (const entry of records) {
    if (entry.error) {
      const line = document.createElement('p')
      line.className = 'error-line'
      line.textContent = `Record #${entry.id}: ${entry.error}`
      container.appendChild(line)
      continue
    }

    if (!entry.data) continue

    // Per-card heading for multi-record views
    if (isMulti) {
      const heading = document.createElement('div')
      heading.className = 'record-heading'
      heading.textContent = getRecordTitle(schema, entry.data)
      container.appendChild(heading)
    }

    const card = buildCard(schema.fields, entry.data)

    if (card.children.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty-state'
      empty.textContent = 'No data available'
      container.appendChild(empty)
      continue
    }

    container.appendChild(card)
  }
}

/**
 * Derive a human-readable title for a record.
 * Checks title, name, first string field, falls back to #id.
 */
function getRecordTitle(schema, record) {
  if (record.title) return record.title
  if (record.name) return record.name

  // First non-empty string field
  for (const field of schema.fields) {
    const val = record[field.name]
    if (field.name !== 'id' && typeof val === 'string' && val) return val
  }

  return record.id ? `#${record.id}` : 'Record'
}

function buildCard(fields, record) {
  const card = document.createElement('div')
  card.className = 'detail-card'

  for (const field of fields) {
    const value = record[field.name]
    if (value === null || value === undefined || value === '') continue
    if (value === false && field.type !== 'boolean') continue

    const isWide = field.type === 'text'

    const row = document.createElement('div')
    row.className = 'detail-row' + (isWide ? ' wide' : '')

    const label = document.createElement('div')
    label.className = 'detail-label'
    label.textContent = field.label

    const valueEl = document.createElement('div')
    valueEl.className = 'detail-value'
    valueEl.appendChild(renderCellValue(value, field))

    row.appendChild(label)
    row.appendChild(valueEl)
    card.appendChild(row)
  }

  return card
}

// ─── Status ─────────────────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar')
