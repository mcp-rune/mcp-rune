/**
 * Center of Control — built-in opt-in `ToolFlowExtension`.
 *
 * Reinstates the "collect → review → confirm → submit" pattern that was
 * baked into the framework before v0.51. The standard model-form flow now
 * defaults to direct submission; servers that need a human-in-the-loop
 * review interstitial register this extension explicitly.
 *
 * When registered:
 *   - `create_model_form` / `update_model_form` advertise `submitMode: 'collect'`.
 *   - The client-side form calls `collect_form_data` on Done instead of
 *     `create_model` / `update_model`.
 *   - `collect_form_data` (app-only) stages the payload into a
 *     session-scoped `FormDataStore`.
 *   - `get_form_data` (model-only) lets the LLM retrieve the staged payload,
 *     present a review to the user, and submit on confirmation.
 *
 * Built-in canonical registration key: `centerOfControl`.
 *
 * Usage:
 * ```js
 * import { createServer } from '@mcp-rune/mcp-rune/server'
 * import { centerOfControlExtension } from '@mcp-rune/mcp-rune/extensions/center-of-control'
 *
 * createServer({
 *   ...,
 *   toolFlowExtensions: { centerOfControl: centerOfControlExtension }
 * })
 * ```
 *
 * The extension depends on a `create_model_form` app being registered so it
 * can derive the form's `resourceUri` and `getHtml` for the
 * `collect_form_data` tool. If no such app exists, registration throws at
 * boot.
 */

import { FormDataStore } from '#src/mcp/apps/form-data-store.js'
import { createFormDataTools } from '#src/mcp/apps/form-data-tools.js'
import type { ToolFlowExtension } from '#src/mcp/extensions/tool-flow.js'

const FORM_TOOL_NAME = 'create_model_form'

export const centerOfControlExtension: ToolFlowExtension = {
  requires: ['apps'],
  register(ctx) {
    const formApp = ctx.getApp(FORM_TOOL_NAME)
    if (!formApp || !formApp.resourceUri || !formApp.getHtml) {
      throw new Error(
        `centerOfControlExtension: "${FORM_TOOL_NAME}" app is required (resourceUri + getHtml). ` +
          'Register createCreateFormApp on the AppRegistry before applying this extension.'
      )
    }

    // Discover the model names accepted by the form from its Zod schema. The
    // form tool's input schema declares `model: z.enum([...names])`, which we
    // re-use to keep the collect tool's accepted models in lockstep without
    // requiring the consumer to thread the list separately.
    const modelNames = extractModelNames(formApp.toolInputSchema as Record<string, unknown>)
    if (modelNames.length === 0) {
      throw new Error(
        `centerOfControlExtension: could not derive model names from ${FORM_TOOL_NAME}.toolInputSchema. ` +
          'Ensure the model input is declared as z.enum([...]).'
      )
    }

    ctx.setFormSubmitMode('collect')

    const store = new FormDataStore()
    ctx.provideContext('formDataStore', store)

    const formDataTools = createFormDataTools(
      formApp.resourceUri,
      modelNames as [string, ...string[]],
      { getHtml: formApp.getHtml }
    )
    for (const tool of formDataTools) {
      ctx.registerTool(tool)
    }

    ctx.logger.info(`[${ctx.name}] active: form Done → collect_form_data → LLM review → submit`, {
      service: ctx.mcpName,
      extensionName: ctx.name,
      models: modelNames.length
    })
  }
}

/** Read enum values from a Zod schema entry without depending on Zod internals. */
function extractModelNames(schema: Record<string, unknown> | undefined): string[] {
  const modelField = schema?.model as
    | { _def?: { values?: unknown[] }; options?: unknown[] }
    | undefined
  if (!modelField) return []
  const values = (modelField._def?.values ?? modelField.options) as unknown
  if (!Array.isArray(values)) return []
  return values.filter((v): v is string => typeof v === 'string')
}
