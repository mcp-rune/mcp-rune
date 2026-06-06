import {
  buildEmbeddingText,
  extractEdgesFromRecord
} from '../../../../src/mcp/analysis-layer/edge-extraction.js'
import type { AssociationConfig } from '../../../../src/mcp/data-layer/api-conventions/base-convention.js'

describe('lib/mcp/analysis-layer/edge-extraction', () => {
  describe('extractEdgesFromRecord', () => {
    const associations: AssociationConfig = {
      belongsTo: {
        author: { target_model: 'author' },
        genre: { target_model: 'genre' }
      },
      hasMany: {
        reviews: { target_model: 'review', many: true }
      }
    }

    it('emits one edge per non-null belongsTo *_id', () => {
      const edges = extractEdgesFromRecord(
        { id: 'b1', author_id: 'a1', genre_id: 'g1', title: 'Clean Code' },
        associations,
        'book'
      )
      expect(edges).toHaveLength(2)
      expect(edges).toContainEqual({
        src_model: 'book',
        src_id: 'b1',
        dst_model: 'author',
        dst_id: 'a1',
        edge_type: 'belongsTo:author'
      })
      expect(edges).toContainEqual({
        src_model: 'book',
        src_id: 'b1',
        dst_model: 'genre',
        dst_id: 'g1',
        edge_type: 'belongsTo:genre'
      })
    })

    it('skips belongsTo when the _id is null or undefined', () => {
      const edges = extractEdgesFromRecord(
        { id: 'b2', author_id: null, genre_id: 'g2' },
        associations,
        'book'
      )
      expect(edges).toHaveLength(1)
      expect(edges[0]!.edge_type).toBe('belongsTo:genre')
    })

    it('emits one edge per element of a hasMany {singular}_ids array', () => {
      const edges = extractEdgesFromRecord(
        { id: 'b3', review_ids: ['r1', 'r2', 'r3'] },
        associations,
        'book'
      )
      expect(edges).toHaveLength(3)
      expect(edges.map((e) => e.dst_id)).toEqual(['r1', 'r2', 'r3'])
      expect(edges.every((e) => e.edge_type === 'hasMany:reviews')).toBe(true)
    })

    it('returns [] when record has no id', () => {
      expect(extractEdgesFromRecord({ author_id: 'a1' }, associations, 'book')).toEqual([])
    })

    it('returns [] when hopFollow is "none"', () => {
      const edges = extractEdgesFromRecord({ id: 'b1', author_id: 'a1' }, associations, 'book', {
        hopFollow: 'none'
      })
      expect(edges).toEqual([])
    })

    it('emits fk:<field> edges in "declared+fk" mode for undeclared *_id', () => {
      const edges = extractEdgesFromRecord(
        { id: 'b1', author_id: 'a1', external_system_id: 'ext-9' },
        associations,
        'book',
        { hopFollow: 'declared+fk' }
      )
      const fk = edges.find((e) => e.edge_type === 'fk:external_system_id')
      expect(fk).toEqual({
        src_model: 'book',
        src_id: 'b1',
        dst_model: 'external_system',
        dst_id: 'ext-9',
        edge_type: 'fk:external_system_id'
      })
    })

    it('does not emit fk: edges in default "declared" mode', () => {
      const edges = extractEdgesFromRecord(
        { id: 'b1', external_system_id: 'ext-9' },
        associations,
        'book'
      )
      expect(edges).toEqual([])
    })
  })

  describe('buildEmbeddingText', () => {
    it('concatenates string and number/boolean attributes in sorted order', () => {
      const text = buildEmbeddingText({
        title: 'Clean Code',
        author: 'Robert C. Martin',
        pages: 464,
        completed: true
      })
      expect(text).toBe('author: Robert C. Martin. completed: true. pages: 464. title: Clean Code')
    })

    it('excludes id and *_id fields', () => {
      const text = buildEmbeddingText({
        id: '42',
        title: 'X',
        author_id: 'a-1',
        genre_id: 'g-1'
      })
      expect(text).toBe('title: X')
    })

    it('skips null, undefined, and empty strings', () => {
      const text = buildEmbeddingText({
        title: 'X',
        author: null,
        notes: undefined,
        subtitle: ''
      })
      expect(text).toBe('title: X')
    })

    it('respects the fields whitelist', () => {
      const text = buildEmbeddingText(
        { title: 'X', author: 'Y', notes: 'Z' },
        { fields: ['title', 'author'] }
      )
      expect(text).toBe('author: Y. title: X')
    })

    it('truncates at maxLength with " …" suffix', () => {
      const long = 'a'.repeat(1000)
      const text = buildEmbeddingText({ desc: long }, { maxLength: 30 })
      expect(text.length).toBe(30)
      expect(text.endsWith(' …')).toBe(true)
    })
  })
})
