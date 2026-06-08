// @vitest-environment happy-dom

import { createFilterPopover } from '../../../../src/mcp/apps/shared/filter-popover.js'

interface Harness {
  trigger: HTMLElement
  panel: HTMLElement
  rows: HTMLElement
  addBtn: HTMLElement
  clearBtn: HTMLElement
  applyBtn: HTMLElement
  popover: ReturnType<typeof createFilterPopover>
  applied: Array<Record<string, unknown>>
}

function mount(
  definitions: Record<string, unknown>,
  currentFilters: Record<string, unknown> = {}
): Harness {
  document.body.innerHTML = `
    <button id="trigger"></button>
    <div id="panel" style="display: none">
      <div id="rows"></div>
      <button id="add"></button>
      <button id="clear"></button>
      <button id="apply"></button>
    </div>
  `
  const trigger = document.getElementById('trigger')!
  const panel = document.getElementById('panel')!
  const rows = document.getElementById('rows')!
  const addBtn = document.getElementById('add')!
  const clearBtn = document.getElementById('clear')!
  const applyBtn = document.getElementById('apply')!

  const applied: Array<Record<string, unknown>> = []
  const popover = createFilterPopover({
    trigger,
    panel,
    rowsContainer: rows,
    addBtn,
    clearBtn,
    applyBtn,
    getDefinitions: () => definitions,
    getCurrentFilters: () => currentFilters,
    onApply: (f) => applied.push(f)
  })

  return { trigger, panel, rows, addBtn, clearBtn, applyBtn, popover, applied }
}

describe('createFilterPopover', () => {
  it('renders a <select> when a filter definition supplies enumValues, regardless of type', () => {
    const h = mount({
      domain: { type: 'relation', label: 'Domain', enumValues: ['Alpha', 'Beta'] }
    })
    h.popover.open()
    const valueEl = h.rows.querySelector('.field-value select') as HTMLSelectElement
    expect(valueEl).toBeTruthy()
    const optionValues = Array.from(valueEl.options).map((o) => o.value)
    expect(optionValues).toEqual(['', 'Alpha', 'Beta'])
  })

  it('falls back to a text input for relation filters without enumValues', () => {
    const h = mount({ owner_id: { type: 'relation', label: 'Owner' } })
    h.popover.open()
    const input = h.rows.querySelector('.field-value input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('text')
  })

  it('keeps the popover open when a row is removed', () => {
    const h = mount({
      a: { type: 'text', label: 'A' },
      b: { type: 'text', label: 'B' }
    })
    h.popover.open()
    h.addBtn.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.rows.querySelectorAll('.mr-popover-row').length).toBe(2)

    const remove = h.rows.querySelector('.btn-remove') as HTMLButtonElement
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(h.rows.querySelectorAll('.mr-popover-row').length).toBe(1)
    expect(h.panel.style.display).not.toBe('none')
  })
})
