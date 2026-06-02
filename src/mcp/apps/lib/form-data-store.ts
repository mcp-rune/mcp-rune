/**
 * Session-scoped form data store for MCP Apps.
 *
 * Stores form data collected by the model-form UI, keyed by model name.
 * The LLM retrieves this data to merge with prerequisites, validate,
 * and submit -- the form never calls create_model directly.
 *
 * Follows the same pattern as SelectionStore.
 */

export interface FormDataEntry {
  model: string
  fields: Record<string, unknown>
  mode: string
  createdAt: number
}

interface FormDataInput {
  model: string
  fields?: Record<string, unknown>
  mode?: string
}

export class FormDataStore {
  private _forms = new Map<string, FormDataEntry>()

  set({ model, fields, mode }: FormDataInput): FormDataEntry {
    const entry: FormDataEntry = {
      model,
      fields: fields || {},
      mode: mode || 'create',
      createdAt: Date.now()
    }
    this._forms.set(model, entry)
    return entry
  }

  get(model?: string): FormDataEntry | null | undefined {
    if (!model) return null
    return this._forms.get(model)
  }

  getAll(): Record<string, FormDataEntry> {
    return Object.fromEntries(this._forms)
  }

  clear(model?: string): void {
    if (model) {
      this._forms.delete(model)
    } else {
      this._forms.clear()
    }
  }

  get size(): number {
    return this._forms.size
  }
}
