/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from 'vitest'

import {
  getKindRenderer,
  helpers,
  registerKindRenderer,
  renderCellValue
} from '../../../../src/mcp/apps/shared/kind-renderers.js'

describe('lib/mcp/apps/shared/kind-renderers', () => {
  describe('DOM rendering', () => {
    it('string renders raw text', () => {
      expect(getKindRenderer('string').render('hello').textContent).toBe('hello')
    })

    it('integer renders the number as text', () => {
      expect(getKindRenderer('integer').render(42).textContent).toBe('42')
    })

    it('boolean renders Yes/No', () => {
      expect(getKindRenderer('boolean').render(true).textContent).toBe('Yes')
      expect(getKindRenderer('boolean').render(false).textContent).toBe('No')
    })

    it('time truncates seconds for display', () => {
      expect(getKindRenderer('time').render('14:30:45').textContent).toBe('14:30')
    })

    it('enum renders a status badge with humanized label', () => {
      const out = getKindRenderer('enum').render('in_progress', { column: { enumHints: {} } })
      expect(out.className).toContain('mr-badge')
      expect(out.textContent).toBe('In Progress')
    })

    it('array renders a tag list', () => {
      const out = getKindRenderer('array').render(['fiction', 'mystery'])
      expect(out.className).toBe('mr-badge-row')
      expect(out.querySelectorAll('.mr-badge')).toHaveLength(2)
    })

    it('json renders a pre block', () => {
      const out = getKindRenderer('json').render({ foo: 1 })
      expect(out.tagName).toBe('PRE')
      expect(out.textContent).toContain('"foo": 1')
    })

    it('url renders an anchor with rel=noopener', () => {
      const out = getKindRenderer('url').render('https://example.com')
      expect(out.tagName).toBe('A')
      expect(out.href).toBe('https://example.com/')
      expect(out.rel).toBe('noopener noreferrer')
    })

    it('email renders a mailto link', () => {
      const out = getKindRenderer('email').render('a@b.com')
      expect(out.tagName).toBe('A')
      expect(out.href).toBe('mailto:a@b.com')
    })

    it('rating renders filled + empty stars up to max', () => {
      const out = getKindRenderer('rating').render(3, { column: { max: 5 } })
      expect(out.textContent).toBe('★★★☆☆')
    })

    it('uuid renders monospace', () => {
      const out = getKindRenderer('uuid').render('550e8400-e29b-41d4-a716-446655440000')
      expect(out.style.fontFamily).toBe('var(--font-mono)')
    })

    it('base64 renders (binary) regardless of value', () => {
      expect(getKindRenderer('base64').render('aGVsbG8=').textContent).toBe('(binary)')
    })

    it('throws UnknownKindError for an unregistered kind (strict mode)', () => {
      // getKindRenderer delegates to getKind, which throws on unknown kinds in
      // strict mode. validateRegistries() catches every model-driven case at
      // server boot; this throw exists for any direct call with a bogus kind.
      expect(() => getKindRenderer('totally-made-up').render('hi')).toThrow(/Unknown kind/)
    })
  })

  describe('getKindRenderer returns the kind descriptor methods alongside DOM render', () => {
    it('integer parse + serialize come from the kind descriptor', () => {
      const k = getKindRenderer('integer')
      expect(k.parse('42')).toBe(42)
      expect(k.serialize(42)).toBe(42)
      expect(k.fromInput('42')).toBe(42)
      expect(k.toInput(42)).toBe('42')
    })
  })

  describe('renderCellValue', () => {
    it('returns an em-dash span for null', () => {
      expect(renderCellValue(null, { kind: 'string' }).textContent).toBe('—')
    })

    it('routes through the renderer for the column kind', () => {
      expect(renderCellValue(true, { kind: 'boolean' }).textContent).toBe('Yes')
    })

    it('falls back to column.type when kind is absent', () => {
      expect(renderCellValue(false, { type: 'boolean' }).textContent).toBe('No')
    })

    it('narrows DOM rendering by format when registered', () => {
      registerKindRenderer(
        'string',
        { render: () => helpers.text('ISBN match') },
        { format: 'test-isbn' }
      )
      expect(renderCellValue('123', { kind: 'string', format: 'test-isbn' }).textContent).toBe(
        'ISBN match'
      )
    })
  })

  describe('registerKindRenderer', () => {
    it('throws when not given a render function', () => {
      expect(() => registerKindRenderer('string', {} as unknown as { render: () => Node })).toThrow(
        /render/
      )
    })

    it('overrides the DOM renderer for a built-in kind', () => {
      registerKindRenderer('boolean', { render: (v) => helpers.text(v ? '✓' : '✗') })
      expect(renderCellValue(true, { kind: 'boolean' }).textContent).toBe('✓')
      // Restore the built-in for subsequent tests.
      registerKindRenderer('boolean', { render: (v) => helpers.text(v ? 'Yes' : 'No') })
    })
  })
})
