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
})
