import { SelectionStore } from '../../../../src/mcp/apps/lib/selection-store.js'

describe('SelectionStore', () => {
  let store

  beforeEach(() => {
    store = new SelectionStore()
  })

  describe('set()', () => {
    it('stores a selection keyed by model', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1', '2'], total: 2 })
      const selection = store.get('activity')
      expect(selection).toMatchObject({
        model: 'activity',
        mode: 'ids',
        ids: ['1', '2'],
        total: 2
      })
    })

    it('replaces previous selection for same model', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      store.set({ model: 'activity', mode: 'ids', ids: ['3', '4'], total: 2 })
      const selection = store.get('activity')
      expect(selection.ids).toEqual(['3', '4'])
      expect(selection.total).toBe(2)
    })

    it('defaults ids to [], filters to {}, total to 0', () => {
      store.set({ model: 'contact', mode: 'ids' })
      const selection = store.get('contact')
      expect(selection.ids).toEqual([])
      expect(selection.filters).toEqual({})
      expect(selection.total).toBe(0)
    })

    it('records createdAt timestamp', () => {
      const before = Date.now()
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      const after = Date.now()
      const selection = store.get('activity')
      expect(selection.createdAt).toBeGreaterThanOrEqual(before)
      expect(selection.createdAt).toBeLessThanOrEqual(after)
    })

    it('returns the stored selection', () => {
      const result = store.set({
        model: 'activity',
        mode: 'filter',
        filters: { status: 'open' },
        total: 5
      })
      expect(result).toMatchObject({
        model: 'activity',
        mode: 'filter',
        filters: { status: 'open' },
        total: 5
      })
    })
  })

  describe('get()', () => {
    it('returns stored selection for model', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      expect(store.get('activity')).toBeDefined()
      expect(store.get('activity').model).toBe('activity')
    })

    it('returns undefined for unknown model', () => {
      expect(store.get('unknown')).toBeUndefined()
    })

    it('returns null when called with no argument', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      expect(store.get()).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(store.get('')).toBeNull()
    })
  })

  describe('getAll()', () => {
    it('returns all selections as plain object', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      store.set({ model: 'contact', mode: 'filter', filters: { city: 'NY' }, total: 10 })
      const all = store.getAll()
      expect(Object.keys(all)).toEqual(['activity', 'contact'])
      expect(all.activity.model).toBe('activity')
      expect(all.contact.model).toBe('contact')
    })

    it('returns empty object when no selections', () => {
      expect(store.getAll()).toEqual({})
    })
  })

  describe('clear()', () => {
    it('removes one model selection when model provided', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      store.set({ model: 'contact', mode: 'ids', ids: ['2'], total: 1 })
      store.clear('activity')
      expect(store.get('activity')).toBeUndefined()
      expect(store.get('contact')).toBeDefined()
    })

    it('removes all selections when called with no argument', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      store.set({ model: 'contact', mode: 'ids', ids: ['2'], total: 1 })
      store.clear()
      expect(store.size).toBe(0)
      expect(store.getAll()).toEqual({})
    })
  })

  describe('size', () => {
    it('returns count of stored selections', () => {
      expect(store.size).toBe(0)
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      expect(store.size).toBe(1)
      store.set({ model: 'contact', mode: 'ids', ids: ['2'], total: 1 })
      expect(store.size).toBe(2)
    })

    it('does not double-count replaced selections', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      store.set({ model: 'activity', mode: 'ids', ids: ['2'], total: 1 })
      expect(store.size).toBe(1)
    })
  })

  describe('concurrent selections across models', () => {
    it('maintains independent selections for different models', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['a1'], total: 1 })
      store.set({ model: 'contact', mode: 'filter', filters: { status: 'active' }, total: 5 })
      store.set({ model: 'deal', mode: 'ids', ids: ['d1', 'd2', 'd3'], total: 3 })

      expect(store.size).toBe(3)
      expect(store.get('activity').ids).toEqual(['a1'])
      expect(store.get('contact').filters).toEqual({ status: 'active' })
      expect(store.get('deal').total).toBe(3)
    })
  })

  describe("set({ strategy: 'add' })", () => {
    it('unions IDs with existing ids-mode selection', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1', '2'], total: 2 })
      const merged = store.set({
        model: 'activity',
        mode: 'ids',
        ids: ['3', '4'],
        strategy: 'add'
      })
      expect(merged.ids.sort()).toEqual(['1', '2', '3', '4'])
      expect(merged.total).toBe(4)
      expect(merged.mode).toBe('ids')
    })

    it('is idempotent: re-adding the same IDs produces the same set', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1', '2'], total: 2 })
      store.set({ model: 'activity', mode: 'ids', ids: ['1', '2', '3'], strategy: 'add' })
      const final = store.set({
        model: 'activity',
        mode: 'ids',
        ids: ['2', '3'],
        strategy: 'add'
      })
      expect(final.ids.sort()).toEqual(['1', '2', '3'])
      expect(final.total).toBe(3)
    })

    it("seeds an empty model with strategy='add'", () => {
      const seeded = store.set({
        model: 'activity',
        mode: 'ids',
        ids: ['1', '2'],
        strategy: 'add'
      })
      expect(seeded.ids.sort()).toEqual(['1', '2'])
      expect(seeded.total).toBe(2)
    })

    it('rejects when the submission itself is filter-mode', () => {
      expect(() =>
        store.set({
          model: 'activity',
          mode: 'filter',
          filters: { status: 'open' },
          strategy: 'add'
        })
      ).toThrow(/filter-mode/i)
    })

    it('rejects when the existing selection is filter-mode', () => {
      store.set({
        model: 'activity',
        mode: 'filter',
        filters: { status: 'open' },
        total: 5
      })
      expect(() =>
        store.set({ model: 'activity', mode: 'ids', ids: ['1'], strategy: 'add' })
      ).toThrow(/filter-mode/i)
    })
  })

  describe('removeIds()', () => {
    it('drops the given IDs from an ids-mode selection', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1', '2', '3'], total: 3 })
      const next = store.removeIds('activity', ['2'])
      expect(next.ids).toEqual(['1', '3'])
      expect(next.total).toBe(2)
    })

    it('returns null and clears the entry when every ID is removed', () => {
      store.set({ model: 'activity', mode: 'ids', ids: ['1'], total: 1 })
      const result = store.removeIds('activity', ['1'])
      expect(result).toBeNull()
      expect(store.get('activity')).toBeUndefined()
    })

    it('returns null for unknown model', () => {
      expect(store.removeIds('unknown', ['1'])).toBeNull()
    })

    it('is a no-op for filter-mode selections', () => {
      store.set({
        model: 'activity',
        mode: 'filter',
        filters: { status: 'open' },
        total: 5
      })
      const result = store.removeIds('activity', ['1'])
      expect(result.mode).toBe('filter')
      expect(result.filters).toEqual({ status: 'open' })
    })
  })
})
