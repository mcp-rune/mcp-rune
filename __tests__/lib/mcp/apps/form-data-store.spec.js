import { describe, it, expect, beforeEach } from 'vitest'
import { FormDataStore } from '../../../../lib/mcp/apps/form-data-store.js'

describe('FormDataStore', () => {
  let store

  beforeEach(() => {
    store = new FormDataStore()
  })

  describe('set()', () => {
    it('stores form data keyed by model', () => {
      store.set({ model: 'activity', fields: { title: 'Run', status: 'draft' }, mode: 'create' })
      const entry = store.get('activity')
      expect(entry).toMatchObject({
        model: 'activity',
        fields: { title: 'Run', status: 'draft' },
        mode: 'create'
      })
    })

    it('replaces previous data for same model', () => {
      store.set({ model: 'activity', fields: { title: 'Old' }, mode: 'create' })
      store.set({ model: 'activity', fields: { title: 'New' }, mode: 'create' })
      const entry = store.get('activity')
      expect(entry.fields).toEqual({ title: 'New' })
    })

    it('defaults fields to {}, mode to "create"', () => {
      store.set({ model: 'book' })
      const entry = store.get('book')
      expect(entry.fields).toEqual({})
      expect(entry.mode).toBe('create')
    })

    it('records createdAt timestamp', () => {
      const before = Date.now()
      store.set({ model: 'activity', fields: { title: 'Run' } })
      const after = Date.now()
      const entry = store.get('activity')
      expect(entry.createdAt).toBeGreaterThanOrEqual(before)
      expect(entry.createdAt).toBeLessThanOrEqual(after)
    })

    it('returns the stored entry', () => {
      const result = store.set({
        model: 'activity',
        fields: { title: 'Run', rating: 5 },
        mode: 'update'
      })
      expect(result).toMatchObject({
        model: 'activity',
        fields: { title: 'Run', rating: 5 },
        mode: 'update'
      })
    })
  })

  describe('get()', () => {
    it('returns stored entry for model', () => {
      store.set({ model: 'activity', fields: { title: 'Run' } })
      expect(store.get('activity')).toBeDefined()
      expect(store.get('activity').model).toBe('activity')
    })

    it('returns undefined for unknown model', () => {
      expect(store.get('unknown')).toBeUndefined()
    })

    it('returns null when called with no argument', () => {
      store.set({ model: 'activity', fields: { title: 'Run' } })
      expect(store.get()).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(store.get('')).toBeNull()
    })
  })

  describe('getAll()', () => {
    it('returns all entries as plain object', () => {
      store.set({ model: 'activity', fields: { title: 'Run' } })
      store.set({ model: 'book', fields: { title: 'Clean Code' } })
      const all = store.getAll()
      expect(Object.keys(all)).toEqual(['activity', 'book'])
      expect(all.activity.model).toBe('activity')
      expect(all.book.model).toBe('book')
    })

    it('returns empty object when no entries', () => {
      expect(store.getAll()).toEqual({})
    })
  })

  describe('clear()', () => {
    it('removes one model entry when model provided', () => {
      store.set({ model: 'activity', fields: { title: 'Run' } })
      store.set({ model: 'book', fields: { title: 'Clean Code' } })
      store.clear('activity')
      expect(store.get('activity')).toBeUndefined()
      expect(store.get('book')).toBeDefined()
    })

    it('removes all entries when called with no argument', () => {
      store.set({ model: 'activity', fields: { title: 'Run' } })
      store.set({ model: 'book', fields: { title: 'Clean Code' } })
      store.clear()
      expect(store.size).toBe(0)
      expect(store.getAll()).toEqual({})
    })
  })

  describe('size', () => {
    it('returns count of stored entries', () => {
      expect(store.size).toBe(0)
      store.set({ model: 'activity', fields: { title: 'Run' } })
      expect(store.size).toBe(1)
      store.set({ model: 'book', fields: { title: 'Clean Code' } })
      expect(store.size).toBe(2)
    })

    it('does not double-count replaced entries', () => {
      store.set({ model: 'activity', fields: { title: 'Old' } })
      store.set({ model: 'activity', fields: { title: 'New' } })
      expect(store.size).toBe(1)
    })
  })

  describe('concurrent entries across models', () => {
    it('maintains independent entries for different models', () => {
      store.set({ model: 'activity', fields: { title: 'Run' }, mode: 'create' })
      store.set({ model: 'book', fields: { title: 'Clean Code' }, mode: 'update' })
      store.set({ model: 'deal', fields: { name: 'Marvel deal' }, mode: 'create' })

      expect(store.size).toBe(3)
      expect(store.get('activity').fields).toEqual({ title: 'Run' })
      expect(store.get('book').mode).toBe('update')
      expect(store.get('deal').fields.name).toBe('Marvel deal')
    })
  })
})
