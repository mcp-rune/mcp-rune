---
extension:
  kind: plugin
  what: Author tool-flow extensions
---

# Tool Flow Extension Guide

A **`ToolFlowExtension`** is a sibling to [`HttpExtension`](./extensions.md). HTTP extensions add routes and middleware; tool-flow extensions modify the MCP **tool surface** and the **runtime context** threaded into app tool handlers. Use one when you want to:

- Register additional MCP App tools tied to an integration (review queues, approval flows, async notifiers).
- Flip the `create_model_form` / `update_model_form` `submitMode` from `'direct'` (write straight to the API) to `'collect'` (stage for review, then submit on confirmation).
- Thread shared per-server state into every app tool handler without coupling each handler to the extension.

The framework ships one — [`centerOfControlExtension`](../../src/extensions/center-of-control.ts) — and exposes the seam so deployers can author their own.

This guide walks through the interface, the Center-of-Control implementation, and a new "Slack-approval" extension as a fresh worked example.

## Table of Contents

- [The Interface](#the-interface)
- [Capability Requirements](#capability-requirements)
- [The Context Methods](#the-context-methods)
- [Worked Example 1: Center-of-Control](#worked-example-1-center-of-control)
- [Worked Example 2: Slack Approval](#worked-example-2-slack-approval)
- [The `provideContext` Pattern](#the-providecontext-pattern)
- [Ordering and Composition](#ordering-and-composition)
- [Testing](#testing)

## The Interface

```ts
import type { ToolFlowExtension } from '@mcp-rune/mcp-rune/extensions'

interface ToolFlowExtension {
  requires?: 'apps'[]
  register(ctx: ToolFlowExtensionContext): void | Promise<void>
}

interface ToolFlowExtensionContext {
  name: string // user-chosen key (for logs)
  mcpName: string // MCP server name
  registerTool(app: AppDefinition): void
  getApp(toolName: string): AppDefinition | undefined
  setFormSubmitMode(mode: 'direct' | 'collect'): void
  provideContext(key: string, value: unknown): void
  logger: typeof logger
}
```

`register` runs **once at server creation**, before app tools are registered on the underlying `McpServer`. It's synchronous from the server factory's perspective (Promises are awaited).

The user-facing config is a map keyed by an extension name:

```ts file=src/server.ts
createServer({
  // …
  toolFlowExtensions: {
    centerOfControl: centerOfControlExtension,
    slackApproval: slackApprovalExtension
  }
})
```

```js file=src/server.js
createServer({
  // …
  toolFlowExtensions: {
    centerOfControl: centerOfControlExtension,
    slackApproval: slackApprovalExtension
  }
})
```

The key is your choice — log lines reference it, and you'll use it again in client code that talks to the extension's tools. Built-in extensions document their conventional key (Center-of-Control uses `centerOfControl`).

## Capability Requirements

`requires` is a list of capabilities the host must have configured. Today the only capability is `'apps'` — meaning the host must have an `AppRegistry`. If an extension declares `requires: ['apps']` and the host doesn't have one, registration **throws at boot**, before the server accepts any connections.

If your extension only needs to register a tool or read state, you can omit `requires`. Declare it whenever you call `getApp` or `setFormSubmitMode`.

## The Context Methods

### `registerTool(app)`

Register a new app tool. The shape is identical to anything you'd pass to `AppRegistry`:

```ts
ctx.registerTool({
  name: 'review_pending_form',
  description: 'Show the user the staged form payload and let them confirm or edit.',
  toolName: 'review_pending_form',
  toolDescription: 'Returns the form HTML for review.',
  toolInputSchema: z.object({}),
  resourceUri: formApp.resourceUri,
  getHtml: formApp.getHtml,
  async handleToolCall(input, context) {
    // context includes whatever provideContext() injected
  }
})
```

### `getApp(toolName)`

Look up an already-registered app. Useful when your extension needs to clone metadata from a framework app (the way Center-of-Control reuses the create-form's `resourceUri` and `getHtml`):

```ts
const formApp = ctx.getApp('create_model_form')
if (!formApp?.resourceUri) {
  throw new Error('myExtension: create_model_form must be registered first')
}
```

### `setFormSubmitMode('collect' | 'direct')`

Flips the submit-mode advertised in every `create_model_form` and `update_model_form` response. Clients respect this — `'collect'` makes the iframe call your collect tool on Done instead of `create_model`/`update_model`.

Use `'collect'` to insert a human-in-the-loop review interstitial. Use `'direct'` (the default) for low-stakes flows.

### `provideContext(key, value)`

Inject a value into the shared context passed to **every app tool handler** in this server. Use it to thread extension-owned state (stores, clients, queues) into handlers without coupling them to the extension:

```ts
const store = new MyApprovalStore()
ctx.provideContext('approvalStore', store)

// Later, inside any app tool's handleToolCall:
async handleToolCall(input, context) {
  const store = context.approvalStore as MyApprovalStore
  await store.enqueue(input)
}
```

This is how `centerOfControlExtension` exposes its `FormDataStore` to the `get_form_data` tool without the tool importing the extension directly.

### `logger`

A shared logger. Use `ctx.logger.info(...)` with structured metadata so log lines tagged by extension name are searchable.

## Worked Example 1: Center-of-Control

The framework's built-in extension — short enough to fit in 30 lines and a perfect template:

```ts
// src/extensions/center-of-control.ts
import { FormDataStore } from '#src/mcp/apps/form-data-store.js'
import { createFormDataTools } from '#src/mcp/apps/form-data-tools.js'
import type { ToolFlowExtension } from '#src/mcp/extensions/tool-flow.js'

export const centerOfControlExtension: ToolFlowExtension = {
  requires: ['apps'],
  register(ctx) {
    const formApp = ctx.getApp('create_model_form')
    if (!formApp?.resourceUri || !formApp.getHtml) {
      throw new Error('centerOfControlExtension: create_model_form app is required')
    }

    // 1. Flip the submit mode.
    ctx.setFormSubmitMode('collect')

    // 2. Spin up a per-server FormDataStore and expose it to other tools.
    const store = new FormDataStore()
    ctx.provideContext('formDataStore', store)

    // 3. Register the collect_form_data + get_form_data tools, sharing the
    //    same resourceUri/getHtml as the create-form app.
    const modelNames = extractModelNames(formApp.toolInputSchema)
    const tools = createFormDataTools(formApp.resourceUri, modelNames as [string, ...string[]], {
      getHtml: formApp.getHtml
    })
    for (const tool of tools) ctx.registerTool(tool)

    ctx.logger.info(`[${ctx.name}] active`, { service: ctx.mcpName, models: modelNames.length })
  }
}
```

Wire-up:

```ts
import { createServer } from '@mcp-rune/mcp-rune/server'
import { centerOfControlExtension } from '@mcp-rune/mcp-rune/extensions/center-of-control'

createServer({
  toolRegistry,
  appRegistry,
  toolFlowExtensions: { centerOfControl: centerOfControlExtension }
})
```

The flow becomes: user fills the form → clicks Done → iframe calls `collect_form_data` → store stages the payload → LLM calls `get_form_data` to display a summary → LLM calls `create_model` or `update_model` on user confirmation. Three new tools, one mode flip, no projection-layer changes.

## Worked Example 2: Slack Approval

A custom extension that posts every create/update to a Slack channel and waits for an emoji reaction before allowing submission:

```ts
// your-server/extensions/slack-approval.ts
import { z } from 'zod'
import type { ToolFlowExtension } from '@mcp-rune/mcp-rune/extensions'
import type { AppDefinition } from '@mcp-rune/mcp-rune/apps'
import { SlackClient } from './slack-client.js'
import { ApprovalStore } from './approval-store.js'

interface SlackApprovalConfig {
  channel: string
  slackToken: string
  approveEmoji?: string
}

export function slackApprovalExtension(config: SlackApprovalConfig): ToolFlowExtension {
  return {
    requires: ['apps'],
    async register(ctx) {
      const formApp = ctx.getApp('create_model_form')
      if (!formApp) throw new Error('slackApproval: create_model_form app required')

      ctx.setFormSubmitMode('collect')

      const slack = new SlackClient(config.slackToken)
      const store = new ApprovalStore({
        slack,
        channel: config.channel,
        approveEmoji: config.approveEmoji ?? '✅'
      })
      ctx.provideContext('approvalStore', store)

      const submitTool: AppDefinition = {
        name: 'request_approval',
        description: 'Stage a model write and post it to Slack for approval.',
        toolName: 'request_approval',
        toolDescription: 'Posts the form payload to Slack and returns an approval ID.',
        toolInputSchema: {
          model: z.string(),
          parent_path: z.string().optional(),
          attributes: z.record(z.string(), z.unknown())
        },
        async handleToolCall(input, context) {
          const approval = context.approvalStore as ApprovalStore
          const id = await approval.post(
            input as { model: string; attributes: Record<string, unknown> }
          )
          return { content: [{ type: 'text', text: `Approval requested: ${id}` }] }
        }
      }

      const checkTool: AppDefinition = {
        name: 'check_approval',
        description: 'Poll for the approval status of a staged write.',
        toolName: 'check_approval',
        toolDescription: 'Returns "pending" | "approved" | "rejected".',
        toolInputSchema: { id: z.string() },
        async handleToolCall(input, context) {
          const approval = context.approvalStore as ApprovalStore
          const status = approval.status((input as { id: string }).id)
          return { content: [{ type: 'text', text: status }] }
        }
      }

      ctx.registerTool(submitTool)
      ctx.registerTool(checkTool)

      ctx.logger.info(`[${ctx.name}] active`, {
        service: ctx.mcpName,
        channel: config.channel
      })
    }
  }
}
```

Wire-up:

```ts
createServer({
  // …
  toolFlowExtensions: {
    centerOfControl: centerOfControlExtension,
    slackApproval: slackApprovalExtension({
      channel: '#approvals',
      slackToken: process.env.SLACK_BOT_TOKEN!
    })
  }
})
```

The LLM workflow: form Done → `request_approval` → tells the user "posted to #approvals, ID abc123" → polls `check_approval` until approved → calls `create_model`.

This is also a good shape for: GitHub PR-based approvals, mTLS-signed write requests, asynchronous email confirmations. The pattern is always (a) intercept submit, (b) stage in extension state, (c) expose tools the LLM uses to drive the human-in-the-loop step, (d) let the LLM call the real write tool on confirmation.

## The `provideContext` Pattern

The `context` argument to every app tool's `handleToolCall` is a flat key-value bag. Built-in apps populate it with `dataLayer`, `searchClient`, `selectionStore`, `formDataStore`. Extensions add to it via `provideContext`.

Two rules:

1. **Pick a unique key.** Convention is the extension name + a short noun (`approvalStore`, `slackQueue`). The framework doesn't enforce uniqueness — if two extensions stomp on the same key, last-write-wins.
2. **Don't expose mutable state casually.** The context bag is shared across every handler in every session. If you provide a `Map`-backed store, the store IS shared state. Use it intentionally (Center-of-Control deliberately scopes its `FormDataStore` per session) or use per-call factories instead.

The pattern lets handlers stay framework-agnostic: a custom tool you wrote three months ago can read `context.approvalStore` today without knowing the Slack extension exists.

## Ordering and Composition

Tool-flow extensions register **before** app tools register on the underlying `McpServer`. Within tool-flow extensions, the order matches the order of the keys in `toolFlowExtensions` (object iteration order, which is insertion order in V8). If two extensions both call `setFormSubmitMode`, the last one wins — log lines will show the conflict, but the framework won't reject it.

Practically: don't mix Center-of-Control with another extension that also flips submit mode. Compose them carefully or pick one.

`provideContext` is additive — two extensions can both contribute keys without conflict, as long as the keys differ.

## Testing

Extensions are functions. Test them by constructing a stub context and asserting the side effects:

```ts
import { describe, expect, it, vi } from 'vitest'
import { slackApprovalExtension } from '../src/extensions/slack-approval'

describe('slackApprovalExtension', () => {
  it('registers two tools and flips submit mode', async () => {
    const tools: unknown[] = []
    const context: Record<string, unknown> = {}
    const ctx = {
      name: 'slackApproval',
      mcpName: 'test',
      registerTool: (t: unknown) => tools.push(t),
      getApp: () => ({
        resourceUri: 'mcp://app/x',
        getHtml: () => '<html></html>',
        toolInputSchema: {}
      }),
      setFormSubmitMode: vi.fn(),
      provideContext: (k: string, v: unknown) => {
        context[k] = v
      },
      logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }
    }

    const ext = slackApprovalExtension({ channel: '#x', slackToken: 'xoxb-test' })
    await ext.register(ctx as never)

    expect(ctx.setFormSubmitMode).toHaveBeenCalledWith('collect')
    expect(tools).toHaveLength(2)
    expect(context.approvalStore).toBeDefined()
  })
})
```

Integration-test through `createServer` with the extension registered, asserting the produced MCP server exposes the new tools and that `create_model_form` advertises `submitMode: 'collect'`.

---

**Related guides:**

- [Authoring Extensions](./authoring-extensions-guide.md) — covers `HttpExtension` and `ApiExtension`. `ToolFlowExtension` is the third sibling.
- [Extensions](./extensions.md) — `HttpExtension` reference.
- [API Extensions](./api-extensions.md) — `ApiExtension` reference.
- [MCP Apps Guide](./mcp-apps-guide.md) — `AppDefinition` shape (what `registerTool` accepts).
