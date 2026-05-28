/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from 'vitest'

import {
  getFormatter,
  helpers,
  registerFormatter,
  renderCellValue
} from '../../../../src/mcp/apps/shared/formatters.js'

describe('lib/mcp/apps/shared/formatters', () => {
  describe('DOM rendering', () => {
    it('string renders raw text', () => {
      expect(getFormatter('string').format('hello').textContent).toBe('hello')
    })

    it('integer renders the number as text', () => {
      expect(getFormatter('integer').format(42).textContent).toBe('42')
    })

    it('boolean renders Yes/No', () => {
      expect(getFormatter('boolean').format(true).textContent).toBe('Yes')
      expect(getFormatter('boolean').format(false).textContent).toBe('No')
    })

    it('time truncates seconds for display', () => {
      expect(getFormatter('time').format('14:30:45').textContent).toBe('14:30')
    })

    it('enum renders a status badge with humanized label', () => {
      const out = getFormatter('enum').format('in_progress', { column: { enumHints: {} } })
      expect(out.className).toContain('status-badge')
      expect(out.textContent).toBe('In Progress')
    })

    it('array renders a tag list', () => {
      const out = getFormatter('array').format(['fiction', 'mystery'])
      expect(out.className).toBe('tag-list')
      expect(out.querySelectorAll('.tag')).toHaveLength(2)
    })

    it('json renders a pre block', () => {
      const out = getFormatter('json').format({ foo: 1 })
      expect(out.tagName).toBe('PRE')
      expect(out.textContent).toContain('"foo": 1')
    })

    it('url renders an anchor with rel=noopener', () => {
      const out = getFormatter('url').format('https://example.com')
      expect(out.tagName).toBe('A')
      expect(out.href).toBe('https://example.com/')
      expect(out.rel).toBe('noopener noreferrer')
    })

    it('email renders a mailto link', () => {
      const out = getFormatter('email').format('a@b.com')
      expect(out.tagName).toBe('A')
      expect(out.href).toBe('mailto:a@b.com')
    })

    it('rating renders filled + empty stars up to max', () => {
      const out = getFormatter('rating').format(3, { column: { max: 5 } })
      expect(out.textContent).toBe('★★★☆☆')
    })

    it('uuid renders monospace', () => {
      const out = getFormatter('uuid').format('550e8400-e29b-41d4-a716-446655440000')
      expect(out.style.fontFamily).toBe('var(--font-mono)')
    })

    it('base64 renders (binary) regardless of value', () => {
      expect(getFormatter('base64').format('aGVsbG8=').textContent).toBe('(binary)')
    })

    it('unknown kind falls back to the string renderer', () => {
      expect(getFormatter('totally-made-up').format('hi').textContent).toBe('hi')
    })
  })

  describe('getFormatter returns the kind-metadata methods alongside DOM format', () => {
    it('integer parse + serialize come from kind-metadata', () => {
      const fmt = getFormatter('integer')
      expect(fmt.parse('42')).toBe(42)
      expect(fmt.serialize(42)).toBe(42)
      expect(fmt.fromInput('42')).toBe(42)
      expect(fmt.toInput(42)).toBe('42')
    })
  })

  describe('renderCellValue', () => {
    it('returns an em-dash span for null', () => {
      expect(renderCellValue(null, { kind: 'string' }).textContent).toBe('—')
    })

    it('routes through the formatter for the column kind', () => {
      expect(renderCellValue(true, { kind: 'boolean' }).textContent).toBe('Yes')
    })

    it('falls back to column.type when kind is absent', () => {
      expect(renderCellValue(false, { type: 'boolean' }).textContent).toBe('No')
    })

    it('narrows DOM rendering by format when registered', () => {
      registerFormatter(
        'string',
        { format: () => helpers.text('ISBN match') },
        { format: 'test-isbn' }
      )
      expect(renderCellValue('123', { kind: 'string', format: 'test-isbn' }).textContent).toBe(
        'ISBN match'
      )
    })
  })

  describe('registerFormatter', () => {
    it('throws when not given a format function', () => {
      expect(() => registerFormatter('string', {} as unknown as { format: () => Node })).toThrow(
        /format/
      )
    })

    it('overrides the DOM renderer for a built-in kind', () => {
      registerFormatter('boolean', { format: (v) => helpers.text(v ? '✓' : '✗') })
      expect(renderCellValue(true, { kind: 'boolean' }).textContent).toBe('✓')
      // Restore the built-in for subsequent tests.
      registerFormatter('boolean', { format: (v) => helpers.text(v ? 'Yes' : 'No') })
    })
  })
})
