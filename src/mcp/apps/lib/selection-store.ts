/**
 * Session-scoped selection store for MCP Apps.
 *
 * Keyed by model name -- supports concurrent selections across different models.
 * Each `set()` call accepts a `strategy`:
 *   - `'replace'` (default): overwrite the model's existing selection.
 *   - `'add'`: union with the existing selection's IDs. Filter-mode is
 *     mutually exclusive with `'add'` on either side because a predicate
 *     plus an ID list can't be losslessly merged.
 */

export interface SelectionEntry {
  model: string
  mode: string
  ids: string[]
  filters: Record<string, unknown>
  total: number
  createdAt: number
}

export type SelectionStrategy = 'replace' | 'add'

export interface SelectionInput {
  model: string
  mode: string
  ids?: string[]
  filters?: Record<string, unknown>
  total?: number
  strategy?: SelectionStrategy
}

export class SelectionMergeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SelectionMergeError'
  }
}

export class SelectionStore {
  private _selections = new Map<string, SelectionEntry>()

  set({ model, mode, ids, filters, total, strategy = 'replace' }: SelectionInput): SelectionEntry {
    if (strategy === 'add') {
      const existing = this._selections.get(model)
      if (mode !== 'ids') {
        throw new SelectionMergeError(
          `Cannot add a filter-mode submission to selection for "${model}". ` +
            `Filter-mode and add-strategy are mutually exclusive — use replace, ` +
            `or materialize the filter to IDs first via materialize_selection.`
        )
      }
      if (existing && existing.mode !== 'ids') {
        throw new SelectionMergeError(
          `Cannot add to filter-mode selection for "${model}". ` +
            `Existing selection is a predicate; materialize it first via materialize_selection ` +
            `or use replace.`
        )
      }
      const union = new Set<string>(existing?.ids ?? [])
      for (const id of ids ?? []) union.add(String(id))
      const merged: SelectionEntry = {
        model,
        mode: 'ids',
        ids: Array.from(union),
        filters: {},
        total: union.size,
        createdAt: Date.now()
      }
      this._selections.set(model, merged)
      return merged
    }

    const selection: SelectionEntry = {
      model,
      mode,
      ids: ids ?? [],
      filters: filters ?? {},
      total: total ?? 0,
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

  /**
   * Drop the given IDs from a model's ids-mode selection. No-op when the
   * selection is filter-mode (the predicate can't be partially edited) or
   * when no selection exists. Returns the resulting entry, or `null` when
   * the selection was cleared because every ID got removed.
   */
  removeIds(model: string, ids: string[]): SelectionEntry | null {
    const existing = this._selections.get(model)
    if (!existing) return null
    if (existing.mode !== 'ids') return existing

    const drop = new Set(ids.map(String))
    const remaining = existing.ids.filter((id) => !drop.has(String(id)))
    if (remaining.length === 0) {
      this._selections.delete(model)
      return null
    }
    const next: SelectionEntry = {
      ...existing,
      ids: remaining,
      total: remaining.length,
      createdAt: Date.now()
    }
    this._selections.set(model, next)
    return next
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
