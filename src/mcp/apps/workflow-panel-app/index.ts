/**
 * Workflow Panel MCP App
 *
 * Presents a deployer-supplied set of workflows as grouped, clickable cards.
 * One click launches the workflow via a deployer-provided server tool
 * (typically `suggest_workflow`).
 *
 * The framework owns the panel chrome and the data-tool plumbing; the
 * launcher tool is wired by the deployer. Categories are derived
 * client-side from each workflow's `tags`.
 */

import type { ToolResult } from '#src/mcp/tools/tool-result.js'

import { createHtmlLoader } from '../lib/html-loader.js'
import type { AppDefinition } from '../lib/registry.js'

const getHtml = createHtmlLoader('workflow-panel-app')

export interface WorkflowPanelEntry {
  /** Stable identifier passed back to `suggest_workflow` on click. */
  name: string
  /** Human-readable card title. */
  title: string
  /** Card body text — truncated client-side at ~120 chars. */
  description: string
  /** Tag list — drives both the visible chips and the category bucket. */
  tags: string[]
  /** When true, render the amber "draft" badge on the card. */
  draftRequired?: boolean
}

export interface WorkflowPanelOptions {
  workflows: WorkflowPanelEntry[]
  namespace: string
}

/**
 * Create the workflow panel app. Returns a `[panelApp, dataApp]` pair: the
 * panel is LLM-visible (so the model can suggest it); the data tool is
 * `visibility: ['app']` and serves the full JSON list to the iframe at
 * connect time.
 */
export function createWorkflowPanelApp({
  workflows,
  namespace
}: WorkflowPanelOptions): AppDefinition[] {
  const resourceUri = `ui://${namespace}/workflow-panel-app`

  const panelApp: AppDefinition = {
    resourceUri,
    toolName: 'workflow_panel_app',
    name: 'Workflow Panel',
    description: 'Interactive launcher showing available workflows as categorized cards',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },

    toolDescription:
      `Show an interactive panel with all available workflows. ` +
      `Each workflow renders as a card grouped by category (derived from tags). ` +
      `Clicking a card launches it via suggest_workflow. ` +
      `Use this when the user wants to browse or launch workflows.`,

    toolInputSchema: {},

    handleToolCall(): Promise<ToolResult> {
      return Promise.resolve({
        content: [
          {
            type: 'text',
            text:
              `Workflow panel displayed with ${workflows.length} workflow${workflows.length === 1 ? '' : 's'}. ` +
              `Do not repeat or list the workflows — the user can see them in the panel. ` +
              `Clicking a card launches it via suggest_workflow.`
          }
        ]
      })
    },

    getHtml
  }

  const dataApp: AppDefinition = {
    toolName: 'workflow_panel_app_data',
    name: 'Workflow Panel Data',
    description: 'Returns workflow data for the panel UI',
    toolDescription: 'Internal: returns workflow data for the panel app.',
    visibility: ['app'],
    annotations: { readOnlyHint: true, idempotentHint: true },
    toolInputSchema: {},

    handleToolCall(): Promise<ToolResult> {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ workflows }) }]
      })
    }
  }

  return [panelApp, dataApp]
}
