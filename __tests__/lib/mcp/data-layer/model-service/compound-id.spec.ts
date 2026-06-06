import {
  buildCollectionPath,
  buildCompoundId,
  parseId
} from '../../../../../src/mcp/data-layer/model-service/compound-id.js'

describe('lib/mcp/services/compound-id', () => {
  // =========================================================================
  // parseId
  // =========================================================================

  describe('parseId', () => {
    it('parses a simple ID', () => {
      const result = parseId('42', 'books')
      expect(result).toEqual({
        segments: [],
        leafId: '42',
        collectionPath: 'books',
        recordPath: 'books/42',
        isCompound: false
      })
    })

    it('parses a compound ID with one nesting level', () => {
      const result = parseId('titles/42/assets/7', 'assets')
      expect(result).toEqual({
        segments: [
          { resource: 'titles', id: '42' },
          { resource: 'assets', id: '7' }
        ],
        leafId: '7',
        collectionPath: 'titles/42/assets',
        recordPath: 'titles/42/assets/7',
        isCompound: true
      })
    })

    it('parses a compound ID with multiple nesting levels', () => {
      const result = parseId('orgs/1/teams/2/projects/3', 'projects')
      expect(result).toEqual({
        segments: [
          { resource: 'orgs', id: '1' },
          { resource: 'teams', id: '2' },
          { resource: 'projects', id: '3' }
        ],
        leafId: '3',
        collectionPath: 'orgs/1/teams/2/projects',
        recordPath: 'orgs/1/teams/2/projects/3',
        isCompound: true
      })
    })

    it('handles string IDs (UUIDs)', () => {
      const result = parseId('titles/abc-123/assets/def-456', 'assets')
      expect(result.isCompound).toBe(true)
      expect(result.leafId).toBe('def-456')
      expect(result.segments).toEqual([
        { resource: 'titles', id: 'abc-123' },
        { resource: 'assets', id: 'def-456' }
      ])
    })
  })

  // =========================================================================
  // buildCompoundId
  // =========================================================================

  describe('buildCompoundId', () => {
    it('builds a compound ID from parent and child parts', () => {
      const result = buildCompoundId('titles', '42', 'assets', '7')
      expect(result).toBe('titles/42/assets/7')
    })
  })

  // =========================================================================
  // buildCollectionPath
  // =========================================================================

  describe('buildCollectionPath', () => {
    it('builds a collection path from parent context', () => {
      const result = buildCollectionPath('titles', '42', 'assets')
      expect(result).toBe('titles/42/assets')
    })
  })
})
