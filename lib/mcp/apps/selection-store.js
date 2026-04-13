/**
 * Session-scoped selection store for MCP Apps.
 *
 * Keyed by model name — supports concurrent selections across different models.
 * Selecting new records for a model replaces that model's previous selection.
 */
export class SelectionStore {
  constructor() {
    this._selections = new Map()
  }

  set({ model, mode, ids, filters, total }) {
    const selection = {
      model,
      mode,
      ids: ids || [],
      filters: filters || {},
      total: total || 0,
      createdAt: Date.now()
    }
    this._selections.set(model, selection)
    return selection
  }

  get(model) {
    return model ? this._selections.get(model) : null
  }

  getAll() {
    return Object.fromEntries(this._selections)
  }

  clear(model) {
    if (model) {
      this._selections.delete(model)
    } else {
      this._selections.clear()
    }
  }

  get size() {
    return this._selections.size
  }
}
