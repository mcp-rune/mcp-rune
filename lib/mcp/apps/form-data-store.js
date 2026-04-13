/**
 * Session-scoped form data store for MCP Apps.
 *
 * Stores form data collected by the model-form UI, keyed by model name.
 * The LLM retrieves this data to merge with prerequisites, validate,
 * and submit — the form never calls create_model directly.
 *
 * Follows the same pattern as SelectionStore.
 */
export class FormDataStore {
  constructor() {
    this._forms = new Map()
  }

  set({ model, fields, mode }) {
    const entry = {
      model,
      fields: fields || {},
      mode: mode || 'create',
      createdAt: Date.now()
    }
    this._forms.set(model, entry)
    return entry
  }

  get(model) {
    return model ? this._forms.get(model) : null
  }

  getAll() {
    return Object.fromEntries(this._forms)
  }

  clear(model) {
    if (model) {
      this._forms.delete(model)
    } else {
      this._forms.clear()
    }
  }

  get size() {
    return this._forms.size
  }
}
