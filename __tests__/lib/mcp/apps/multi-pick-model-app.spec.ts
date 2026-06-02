import { createMultiPickModelApp } from '../../../../src/mcp/apps/multi-pick-model-app/index.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

class FakeModel {
  static api = { endpoint: '/fakes' }
  static attributes = ['id', 'name']
  static attributesConfig = { id: { type: 'integer' }, name: { type: 'string' } }
  static extensions = { search: { lookup: { fields: ['name'] } } }
  constructor(data) {
    this.data = data
  }
  get displayValue() {
    return this.data.name
  }
  get lookupFields() {
    return {}
  }
}

const modelClasses = { fake: FakeModel }
const namespace = 'test'

describe('multi_pick_model_app', () => {
  const tools = createMultiPickModelApp({ modelClasses, namespace })
  const multiSelectTool = tools[0]

  it('description warns against use for existing selections', () => {
    expect(multiSelectTool.toolDescription).toMatch(/Do NOT use this when/)
    expect(multiSelectTool.toolDescription).toMatch(/get_selection/)
  })

  it('description directs to get_selection for "selected" records', () => {
    expect(multiSelectTool.toolDescription).toMatch(/call get_selection first/)
  })

  it('description says to use only for new selections', () => {
    expect(multiSelectTool.toolDescription).toMatch(
      /ONLY when the user needs to make a NEW selection/
    )
  })

  it('has no explicit visibility (defaults via registry)', () => {
    expect(multiSelectTool.visibility).toBeUndefined()
  })

  it('routes record fetching through dataLayer.searchNormalized', async () => {
    const dataLayer = {
      calls: [],
      async searchNormalized(model, query, filters, pagination) {
        this.calls.push({ model, query, filters, pagination })
        return {
          records: [
            { id: 1, name: 'Alpha' },
            { id: 2, name: 'Beta' }
          ],
          pagination: { page: 1, per_page: 200, total: 2 }
        }
      }
    }

    const result = await multiSelectTool.handleToolCall({ model: 'fake' }, { dataLayer })
    const payload = JSON.parse(result.content[0].text)

    expect(payload.model).toBe('fake')
    expect(payload.records).toHaveLength(2)
    expect(payload.records[0]).toEqual({ id: 1, display: 'Alpha' })
    expect(dataLayer.calls).toHaveLength(1)
    expect(dataLayer.calls[0]).toMatchObject({
      model: 'fake',
      query: undefined,
      filters: undefined,
      pagination: { page: 1, perPage: 200 }
    })
  })

  it('returns empty records list when dataLayer is unavailable', async () => {
    const result = await multiSelectTool.handleToolCall({ model: 'fake' }, {})
    const payload = JSON.parse(result.content[0].text)
    expect(payload.records).toEqual([])
  })

  it('handles unknown model with a structured error', async () => {
    const dataLayer = {
      async searchNormalized() {
        throw new Error('should not be called')
      }
    }
    const result = await multiSelectTool.handleToolCall({ model: 'unknown' }, { dataLayer })
    const payload = JSON.parse(result.content[0].text)
    expect(payload.error).toMatch(/Unknown model/)
  })
})
