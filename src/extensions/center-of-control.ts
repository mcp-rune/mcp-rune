/**
 * Center of Control — built-in opt-in `ToolFlowExtension`.
 *
 * Reinstates the "collect → review → confirm → submit" pattern that was
 * baked into the framework before v0.51. The standard model-form flow now
 * defaults to direct submission; servers that need a human-in-the-loop
 * review interstitial register this extension explicitly.
 *
 * When registered:
 *   - `new_model_app` / `edit_model_app` advertise `submitMode: 'collect'`.
 *   - The client-side form calls `collect_form_data` on Done instead of
 *     `create_model` / `update_model`.
 *   - `collect_form_data` (app-only) stages the payload into a
 *     session-scoped `FormDataStore`. Its iframe UI is bound to the
 *     `new_model_app` bundle's resourceUri + getHtml; since both form-app
 *     bundles wrap the same shared `shared/model-form/main.js` module,
 *     the review interstitial renders identically whether the source was a
 *     new or edit submission.
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
 * The extension depends on a `new_model_app` app being registered so it
 * can derive the form's `resourceUri` and `getHtml` for the
 * `collect_form_data` tool. If no such app exists, registration throws at
 * boot.
 */

import { AppFormDataStore } from '#src/mcp/apps/lib/app-form-data-store.js'
import { createAppFormDataTools } from '#src/mcp/apps/lib/app-form-data-tools.js'
import { defineContextKey, type ToolFlowExtension } from '#src/mcp/extensions/tool-flow.js'

const FORM_TOOL_NAME = 'new_model_app'

/**
 * Typed key for the per-server `FormDataStore` that `centerOfControlExtension`
 * threads into every app-tool handler's context. Consumers (the
 * `collect_form_data` / `get_form_data` tools, plus any deployer-built tool
 * that needs to read staged form payloads) import this key to read the store
 * with its typed shape.
 */
export const FORM_DATA_STORE_KEY = defineContextKey<AppFormDataStore>('formDataStore')

export const centerOfControlExtension: ToolFlowExtension = {
  requires: ['apps'],
  register(ctx) {
    const formApp = ctx.getApp(FORM_TOOL_NAME)
    if (!formApp || !formApp.resourceUri || !formApp.getHtml) {
      throw new Error(
        `centerOfControlExtension: "${FORM_TOOL_NAME}" app is required (resourceUri + getHtml). ` +
          'Register createNewModelApp on the AppRegistry before applying this extension.'
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

    const store = new AppFormDataStore()
    ctx.provideContext(FORM_DATA_STORE_KEY, store)

    const formDataTools = createAppFormDataTools(
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
