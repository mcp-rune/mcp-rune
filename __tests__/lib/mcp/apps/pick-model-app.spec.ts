import { createPickModelApp } from '../../../../src/mcp/apps/pick-model-app/index.js'

class FakeModel {
  static api = { endpoint: '/fakes' }
  static singularName = 'fake'
  static attributes = ['id', 'name']
  static extensions = { search: { lookup: { fields: ['name'] } } }
  constructor(data) {
    this.data = data
  }
  get displayValue() {
    return this.data.name
  }
  get lookupFields() {
    return { name: this.data.name }
  }
}

class TitleModel {
  static api = { endpoint: '/titles' }
  static singularName = 'title'
  static attributes = ['id', 'name', 'kind']
  static extensions = {
    search: {
      lookup: { fields: ['name'] },
      query: { group: 'catalogue', modelName: ['episode', 'feature'] }
    }
  }
  constructor(data) {
    this.data = data
  }
  get displayValue() {
    return this.data.name
  }
  get lookupFields() {
    return { name: this.data.name }
  }
}

const namespace = 'test'

function fakeDataLayer(records = []) {
  return {
    lookupCalls: [],
    groupCalls: [],
    async lookupNormalized(model, query, options) {
      this.lookupCalls.push({ model, query, options })
      return {
        records,
        pagination: { page: 1, per_page: options?.perPage ?? 10, total: records.length }
      }
    },
    async groupSearchNormalized(group, query, options) {
      this.groupCalls.push({ group, query, options })
      return {
        records,
        pagination: { page: 1, per_page: options?.perPage ?? 20, total: records.length }
      }
    }
  }
}

describe('pick_model_app', () => {
  describe('single-model mode', () => {
    const tools = createPickModelApp({ modelClasses: { fake: FakeModel }, namespace })
    const pickTool = tools[0]

    it('registers as pick_model_app with the expected resourceUri', () => {
      expect(pickTool.toolName).toBe('pick_model_app')
      expect(pickTool.resourceUri).toMatch(/pick-model-app$/)
    })

    it('routes single-model lookup through dataLayer.lookupNormalized', async () => {
      const dataLayer = fakeDataLayer([
        { id: '1', name: 'Alpha' },
        { id: '2', name: 'Beta' }
      ])
      const result = await pickTool.handleToolCall(
        { model: 'fake', query: 'al', limit: 5 },
        { dataLayer }
      )
      const payload = JSON.parse(result.content[0].text)

      expect(payload.model).toBe('fake')
      expect(payload.results).toHaveLength(2)
      expect(payload.results[0]).toMatchObject({ id: '1', display: 'Alpha' })
      expect(dataLayer.lookupCalls).toHaveLength(1)
      expect(dataLayer.lookupCalls[0]).toMatchObject({
        model: 'fake',
        query: 'al',
        options: { perPage: 5 }
      })
    })

    it('returns empty results when no query is supplied', async () => {
      const dataLayer = fakeDataLayer([{ id: '1', name: 'Alpha' }])
      const result = await pickTool.handleToolCall({ model: 'fake' }, { dataLayer })
      const payload = JSON.parse(result.content[0].text)
      expect(payload.results).toEqual([])
      expect(dataLayer.lookupCalls).toHaveLength(0)
    })

    it('errors with available models when model is unknown', async () => {
      const dataLayer = fakeDataLayer()
      const result = await pickTool.handleToolCall({ model: 'unknown', query: 'x' }, { dataLayer })
      const payload = JSON.parse(result.content[0].text)
      expect(payload.error).toMatch(/Unknown model/)
    })
  })

  describe('group mode', () => {
    const searchGroups = {
      catalogue: { name: 'Catalogue', typeField: 'kind' }
    }
    const tools = createPickModelApp({
      modelClasses: { title: TitleModel },
      searchGroups,
      namespace
    })
    const pickTool = tools[0]

    it('exposes the group enum in the tool schema', () => {
      expect(pickTool.toolInputSchema.group).toBeDefined()
      expect(pickTool.toolInputSchema.model).toBeDefined()
    })

    it('routes group search through dataLayer.groupSearchNormalized', async () => {
      const dataLayer = fakeDataLayer([
        { id: '10', name: 'Drama', kind: 'feature' },
        { id: '11', name: 'Pilot', kind: 'episode' }
      ])
      const result = await pickTool.handleToolCall(
        { group: 'catalogue', query: 'd', limit: 8 },
        { dataLayer }
      )
      const payload = JSON.parse(result.content[0].text)

      expect(payload.group).toBe('catalogue')
      expect(payload.results).toHaveLength(2)
      expect(payload.results[0]).toMatchObject({
        id: '10',
        display: 'Drama',
        entityType: 'feature'
      })
      expect(dataLayer.groupCalls).toHaveLength(1)
      expect(dataLayer.groupCalls[0]).toMatchObject({
        group: 'catalogue',
        query: 'd',
        options: { perPage: 8 }
      })
    })

    it('rejects when both model and group are supplied', async () => {
      const dataLayer = fakeDataLayer()
      const result = await pickTool.handleToolCall(
        { model: 'title', group: 'catalogue', query: 'd' },
        { dataLayer }
      )
      const payload = JSON.parse(result.content[0].text)
      expect(payload.error).toMatch(/either model or group/)
    })

    it('errors when neither model nor group is supplied', async () => {
      const dataLayer = fakeDataLayer()
      const result = await pickTool.handleToolCall({ query: 'x' }, { dataLayer })
      const payload = JSON.parse(result.content[0].text)
      expect(payload.error).toMatch(/Provide either model/)
    })

    it('errors when the group is unknown', async () => {
      const dataLayer = fakeDataLayer()
      const result = await pickTool.handleToolCall({ group: 'unknown', query: 'x' }, { dataLayer })
      const payload = JSON.parse(result.content[0].text)
      expect(payload.error).toMatch(/Unknown group/)
    })
  })

  describe('handler context contract', () => {
    const tools = createPickModelApp({ modelClasses: { fake: FakeModel }, namespace })
    const pickTool = tools[0]

    it('never reads searchClient from context (DataLayer-only contract)', async () => {
      // Pass only dataLayer; if the handler still reaches for searchClient,
      // the missing methods would throw. This is the projection-layer-rule
      // smoke test.
      const dataLayer = fakeDataLayer([])
      const result = await pickTool.handleToolCall(
        { model: 'fake', query: 'whatever' },
        { dataLayer }
      )
      expect(result.content).toBeDefined()
    })
  })
})
