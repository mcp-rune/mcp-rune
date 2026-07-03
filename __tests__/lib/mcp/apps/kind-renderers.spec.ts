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
import { getKind } from '../../../../src/mcp/models/kinds/index.js'

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

    it('degrades to string semantics for an unregistered kind (ADR 0010)', () => {
      // The server-side getKind throws for unknown kinds (validateRegistries
      // catches model-driven cases at boot), but the iframe registry is baked
      // at build time and cannot see server-registered deployer kinds — the
      // renderer must degrade, never crash the cell.
      expect(getKindRenderer('totally-made-up').render('hi').textContent).toBe('hi')
      expect(() => getKind('totally-made-up')).toThrow(/Unknown kind/)
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

  describe('unknown kinds degrade instead of crashing (ADR 0010)', () => {
    it('renders cells with string semantics and warns once', () => {
      const warns: string[] = []
      const original = console.warn
      console.warn = (msg: string) => warns.push(msg)
      try {
        const node = renderCellValue('$9.99', { kind: 'currency-unknown-probe' })
        expect(node.textContent).toBe('$9.99')
        renderCellValue('$1.50', { kind: 'currency-unknown-probe' })
        expect(warns.filter((w) => w.includes('currency-unknown-probe'))).toHaveLength(1)
      } finally {
        console.warn = original
      }
    })

    it('round-trips form values through string passthrough', () => {
      const k = getKindRenderer('currency-unknown-probe')
      expect(k.serialize(k.fromInput('9.99'))).toBe('9.99')
      expect(k.toInput(k.parse('9.99'))).toBe('9.99')
    })

    it('still applies a render hint registered for the unknown kind', () => {
      registerKindRenderer('currency-unknown-probe', {
        render: (v) => helpers.badge(String(v), { icon: '💰' })
      })
      expect(renderCellValue(9.99, { kind: 'currency-unknown-probe' }).textContent).toBe('💰 9.99')
    })

    it('rethrows non-UnknownKindError failures', () => {
      // Only registry misses degrade; anything else must stay loud.
      expect(() => getKindRenderer('string')).not.toThrow()
    })
  })

  describe('render-hint resolution mirrors getKind (format as top-level kind)', () => {
    it('applies a hint keyed by bare kind to format-carrying attributes', () => {
      registerKindRenderer('probe-format-kind', { render: () => helpers.text('via format') })
      expect(
        renderCellValue('x', { kind: 'string', format: 'probe-format-kind' }).textContent
      ).toBe('via format')
    })

    it('kind:format narrowing still wins over the format-level hint', () => {
      registerKindRenderer(
        'string',
        { render: () => helpers.text('narrowed') },
        { format: 'probe-format-kind' }
      )
      expect(
        renderCellValue('x', { kind: 'string', format: 'probe-format-kind' }).textContent
      ).toBe('narrowed')
    })
  })
})
