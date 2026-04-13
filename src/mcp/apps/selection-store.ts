/**
 * Session-scoped selection store for MCP Apps.
 *
 * Keyed by model name -- supports concurrent selections across different models.
 * Selecting new records for a model replaces that model's previous selection.
 */

export interface SelectionEntry {
  model: string
  mode: string
  ids: string[]
  filters: Record<string, unknown>
  total: number
  createdAt: number
}

interface SelectionInput {
  model: string
  mode: string
  ids?: string[]
  filters?: Record<string, unknown>
  total?: number
}

export class SelectionStore {
  private _selections = new Map<string, SelectionEntry>()

  set({ model, mode, ids, filters, total }: SelectionInput): SelectionEntry {
    const selection: SelectionEntry = {
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

  get(model?: string): SelectionEntry | null | undefined {
    if (!model) return null
    return this._selections.get(model)
  }

  getAll(): Record<string, SelectionEntry> {
    return Object.fromEntries(this._selections)
  }

  clear(model?: string): void {
    if (model) {
      this._selections.delete(model)
    } else {
      this._selections.clear()
    }
  }

  get size(): number {
    return this._selections.size
  }
}
