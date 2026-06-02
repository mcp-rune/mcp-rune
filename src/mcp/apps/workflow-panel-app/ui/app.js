/**
 * Workflow Panel — client-side.
 *
 * Renders grouped workflow cards. Clicking a card calls the deployer's
 * `suggest_workflow` server tool, then nudges the host conversation to
 * execute the workflow.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import { initApp, showStatus, clearStatus } from '../../shared/app-init.js'

// ─── Category configuration ─────────────────────────────────────────────────
// Workflows are bucketed by the first matching category. Ordering here is the
// display order; anything that matches nothing lands in "Other".
const CATEGORIES = [
  { name: 'Daily tracking', matchTags: ['activity'] },
  { name: 'Analysis & review', matchTags: ['analysis', 'agenda'] },
  { name: 'Setup & organization', matchTags: ['onboarding', 'configuration'] },
  { name: 'Library management', matchTags: ['housekeeping'] }
]

// ─── MCP App connection ─────────────────────────────────────────────────────

const app = new App({ name: 'Workflow Panel', version: '1.0.0' })

const statusBar = document.getElementById('status-bar')
const panel = document.getElementById('wf-panel')
const countEl = document.getElementById('wf-count')

app.ontoolinput = () => {}
app.ontoolresult = () => {
  // Tool result is a text summary for the LLM only; data is fetched after connect.
}

await app.connect()
initApp(app)

// ─── Data fetch ─────────────────────────────────────────────────────────────

try {
  const response = await app.callServerTool({
    name: 'workflow_panel_app_data',
    arguments: {}
  })
  const textContent = response?.content?.find((c) => c.type === 'text')
  if (textContent) {
    const data = JSON.parse(textContent.text)
    if (data.workflows) renderWorkflows(data.workflows)
  }
} catch (err) {
  panel.innerHTML = `<div class="mr-empty">Failed to load workflows: ${err.message}</div>`
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function categorizeWorkflows(workflows) {
  const groups = new Map()
  const uncategorized = []

  for (const workflow of workflows) {
    let matched = false
    for (const category of CATEGORIES) {
      if (category.matchTags.some((tag) => workflow.tags.includes(tag))) {
        if (!groups.has(category.name)) groups.set(category.name, [])
        groups.get(category.name).push(workflow)
        matched = true
        break
      }
    }
    if (!matched) uncategorized.push(workflow)
  }

  const ordered = []
  for (const category of CATEGORIES) {
    if (groups.has(category.name)) {
      ordered.push({ name: category.name, workflows: groups.get(category.name) })
    }
  }
  if (uncategorized.length > 0) {
    ordered.push({ name: 'Other', workflows: uncategorized })
  }
  return ordered
}

function truncate(text, maxLength = 160) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trimEnd() + '…'
}

function renderWorkflows(workflows) {
  panel.innerHTML = ''
  countEl.innerHTML = `<span class="dash">—</span>${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`

  const groups = categorizeWorkflows(workflows)

  for (const group of groups) {
    const section = document.createElement('div')
    section.className = 'mr-wf-group'

    const head = document.createElement('div')
    head.className = 'mr-wf-grouphead'
    head.innerHTML =
      `<span class="lbl">${escapeHtml(group.name)}</span>` +
      `<span class="line"></span>` +
      `<span class="ct">${group.workflows.length}</span>`
    section.appendChild(head)

    for (const workflow of group.workflows) {
      const card = document.createElement('div')
      card.className = 'mr-wf-card'
      card.addEventListener('click', () => launchWorkflow(workflow.name, workflow.title))

      const top = document.createElement('div')
      top.className = 'mr-wf-top'

      const name = document.createElement('span')
      name.className = 'mr-wf-name'
      name.textContent = workflow.title
      top.appendChild(name)

      if (workflow.draftRequired) {
        const badge = document.createElement('span')
        badge.className = 'mr-badge wip'
        badge.title = 'Requires draft preview before applying changes'
        badge.textContent = 'draft'
        top.appendChild(badge)
      }

      const launch = document.createElement('span')
      launch.className = 'mr-wf-launch'
      launch.textContent = 'run workflow →'
      top.appendChild(launch)

      card.appendChild(top)

      const desc = document.createElement('p')
      desc.className = 'mr-wf-desc'
      desc.textContent = truncate(workflow.description)
      card.appendChild(desc)

      if (workflow.tags?.length) {
        const tags = document.createElement('div')
        tags.className = 'mr-wf-tags'
        for (const tag of workflow.tags) {
          const t = document.createElement('span')
          t.className = 'mr-wf-tag'
          t.textContent = tag
          tags.appendChild(t)
        }
        card.appendChild(tags)
      }

      section.appendChild(card)
    }

    panel.appendChild(section)
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

// ─── Launch ─────────────────────────────────────────────────────────────────

async function launchWorkflow(name, title) {
  clearStatus(statusBar)
  showStatus(statusBar, 'Launching ' + title + '…', 'info')

  try {
    const caps = app.getHostCapabilities()

    if (caps?.serverTools && caps?.updateModelContext) {
      const toolResult = await app.callServerTool({
        name: 'suggest_workflow',
        arguments: { workflow: name }
      })

      if (toolResult.isError) {
        showStatus(statusBar, 'Failed to load workflow instructions', 'error')
        return
      }

      await app.updateModelContext({ content: toolResult.content })

      const result = await app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: `Execute the "${title}" workflow` }]
      })

      if (result.isError) {
        showStatus(statusBar, 'Failed to launch: host rejected the message', 'error')
      } else {
        showStatus(statusBar, 'Launched: ' + title, 'success')
      }
    } else {
      const result = await app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Launch the "${title}" workflow using the suggest_workflow tool with workflow: "${name}"`
          }
        ]
      })
      if (result.isError) {
        showStatus(statusBar, 'Failed to launch: host rejected the message', 'error')
      } else {
        showStatus(statusBar, 'Launched: ' + title, 'success')
      }
    }
  } catch (err) {
    showStatus(statusBar, 'Failed to launch: ' + err.message, 'error')
  }
}
