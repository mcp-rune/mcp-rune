/**
 * @vitest-environment happy-dom
 */

import {
  getFormatter,
  helpers,
  registerFormatter,
  renderCellValue
} from '../../../../src/mcp/apps/shared/formatters.js'

describe('lib/mcp/apps/shared/formatters', () => {
  describe('built-in formatters', () => {
    it('string passes value through unchanged', () => {
      const fmt = getFormatter('string')
      expect(fmt.parse('hello')).toBe('hello')
      expect(fmt.serialize('hello')).toBe('hello')
      expect(fmt.format('hello').textContent).toBe('hello')
    })

    it('integer parses to Number, serializes through unchanged, round-trips through input', () => {
      const fmt = getFormatter('integer')
      expect(fmt.parse('42')).toBe(42)
      expect(fmt.fromInput('42')).toBe(42)
      expect(fmt.toInput(42)).toBe('42')
      expect(fmt.serialize(42)).toBe(42)
      expect(fmt.format(42).textContent).toBe('42')
    })

    it('boolean renders Yes/No, coerces truthy strings, round-trips', () => {
      const fmt = getFormatter('boolean')
      expect(fmt.parse('true')).toBe(true)
      expect(fmt.parse(false)).toBe(false)
      expect(fmt.format(true).textContent).toBe('Yes')
      expect(fmt.format(false).textContent).toBe('No')
      expect(fmt.fromInput('on')).toBe(true)
      expect(fmt.serialize(1)).toBe(true)
    })

    it('date round-trips API ISO ⇄ <input type=date> ⇄ API ISO', () => {
      const fmt = getFormatter('date')
      const internal = fmt.parse('2026-05-28')
      expect(internal).toBeInstanceOf(Date)
      expect(fmt.toInput(internal)).toBe('2026-05-28')
      const reparsed = fmt.fromInput('2026-05-28')
      expect(fmt.serialize(reparsed)).toBe('2026-05-28')
    })

    it('datetime round-trips API ISO ⇄ <input type=datetime-local> ⇄ API ISO', () => {
      const fmt = getFormatter('datetime')
      const internal = fmt.parse('2026-05-28T14:30:00Z')
      expect(internal).toBeInstanceOf(Date)
      expect(fmt.toInput(internal)).toBe('2026-05-28T14:30')
      const reparsed = fmt.fromInput('2026-05-28T14:30')
      expect(fmt.serialize(reparsed)).toBe('2026-05-28T14:30:00.000Z')
    })

    it('time truncates seconds for the HTML input', () => {
      const fmt = getFormatter('time')
      expect(fmt.parse('14:30:45')).toBe('14:30:45')
      expect(fmt.toInput('14:30:45')).toBe('14:30')
      expect(fmt.fromInput('14:30')).toBe('14:30')
    })

    it('enum renders a status badge with humanized label', () => {
      const fmt = getFormatter('enum')
      const out = fmt.format('in_progress', { column: { enumHints: {} } })
      expect(out.className).toContain('status-badge')
      expect(out.textContent).toBe('In Progress')
    })

    it('array parses non-arrays into single-item arrays and renders a tag list', () => {
      const fmt = getFormatter('array')
      expect(fmt.parse(['a', 'b'])).toEqual(['a', 'b'])
      expect(fmt.parse('solo')).toEqual(['solo'])
      expect(fmt.parse(null)).toEqual([])
      const out = fmt.format(['fiction', 'mystery'])
      expect(out.className).toBe('tag-list')
      expect(out.querySelectorAll('.tag')).toHaveLength(2)
    })

    it('json round-trips object ⇄ pretty-printed input ⇄ object', () => {
      const fmt = getFormatter('json')
      const obj = { foo: 1, bar: [2, 3] }
      const input = fmt.toInput(obj)
      expect(input).toContain('"foo": 1')
      expect(fmt.fromInput(input)).toEqual(obj)
    })

    it('url renders an anchor tag with rel=noopener', () => {
      const fmt = getFormatter('url')
      const out = fmt.format('https://example.com')
      expect(out.tagName).toBe('A')
      expect(out.href).toBe('https://example.com/')
      expect(out.rel).toBe('noopener noreferrer')
    })

    it('email renders a mailto link', () => {
      const fmt = getFormatter('email')
      const out = fmt.format('a@b.com')
      expect(out.tagName).toBe('A')
      expect(out.href).toBe('mailto:a@b.com')
    })

    it('rating renders filled + empty stars up to max', () => {
      const fmt = getFormatter('rating')
      expect(fmt.parse('3')).toBe(3)
      const out = fmt.format(3, { column: { max: 5 } })
      expect(out.textContent).toBe('★★★☆☆')
    })

    it('unknown kind falls back to the string formatter', () => {
      const fmt = getFormatter('totally-made-up')
      expect(fmt.parse('hi')).toBe('hi')
      expect(fmt.format('hi').textContent).toBe('hi')
    })
  })

  describe('renderCellValue', () => {
    it('returns an em-dash span for null', () => {
      const out = renderCellValue(null, { kind: 'string' })
      expect(out.textContent).toBe('—')
    })

    it('routes through the formatter for the column kind', () => {
      const out = renderCellValue(true, { kind: 'boolean' })
      expect(out.textContent).toBe('Yes')
    })

    it('falls back to column.type when kind is absent (back-compat with existing schemas)', () => {
      const out = renderCellValue(false, { type: 'boolean' })
      expect(out.textContent).toBe('No')
    })

    it('narrows by format when both kind and format match a registered key', () => {
      registerFormatter(
        'string',
        { format: () => helpers.text('ISBN match') },
        { format: 'test-isbn' }
      )
      const out = renderCellValue('123', { kind: 'string', format: 'test-isbn' })
      expect(out.textContent).toBe('ISBN match')
    })
  })

  describe('registerFormatter override', () => {
    it('lets deployers replace a built-in kind entirely', () => {
      registerFormatter('boolean', { format: (v) => helpers.text(v ? '✓' : '✗') })
      expect(renderCellValue(true, { kind: 'boolean' }).textContent).toBe('✓')
      // Re-register the built-in for subsequent tests.
      registerFormatter('boolean', {
        parse: (v) => v === true || v === 'true' || v === 1 || v === '1',
        format: (v) => helpers.text(v ? 'Yes' : 'No'),
        toInput: (v) => (v ? 'true' : 'false'),
        fromInput: (v) => v === true || v === 'true' || v === 'on',
        serialize: (v) => Boolean(v)
      })
    })
  })
})
