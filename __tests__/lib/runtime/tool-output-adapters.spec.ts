import {
  adaptToolOutput,
  pickFields,
  registerOutputAdapter
} from '../../../src/runtime/tool-output-adapters.js'

describe('lib/services/tool-output-adapters', () => {
  describe('pickFields', () => {
    it('should extract named fields from response', () => {
      const adapter = pickFields(['id', 'name', 'status'])
      const result = adapter({ id: '123', name: 'Test', status: 'active', extra: 'ignored' })

      expect(result).toEqual({ id: '123', name: 'Test', status: 'active' })
    })

    it('should skip undefined fields', () => {
      const adapter = pickFields(['id', 'name', 'missing'])
      const result = adapter({ id: '123', name: 'Test' })

      expect(result).toEqual({ id: '123', name: 'Test' })
    })

    it('should return null for empty response', () => {
      const adapter = pickFields(['id', 'name'])
      expect(adapter(null)).toBeNull()
      expect(adapter(undefined)).toBeNull()
    })

    it('should return null for non-object response', () => {
      const adapter = pickFields(['id'])
      expect(adapter('string')).toBeNull()
      expect(adapter(42)).toBeNull()
    })

    it('should return null when no fields match', () => {
      const adapter = pickFields(['id', 'name'])
      const result = adapter({ other: 'value' })

      expect(result).toBeNull()
    })

    it('should include fields with falsy values except undefined', () => {
      const adapter = pickFields(['id', 'name', 'count', 'active'])
      const result = adapter({ id: '123', name: '', count: 0, active: false })

      expect(result).toEqual({ id: '123', name: '', count: 0, active: false })
    })
  })

  describe('registerOutputAdapter + adaptToolOutput', () => {
    beforeEach(() => {
      // Register a test adapter
      registerOutputAdapter('test_tool', (response) => {
        return { extracted: response.value }
      })
    })

    it('should call registered adapter', () => {
      const result = adaptToolOutput('test_tool', { value: 'hello' })

      expect(result).toEqual({ extracted: 'hello' })
    })

    it('should return null for unregistered tool', () => {
      const result = adaptToolOutput('unknown_tool', { value: 'hello' })

      expect(result).toBeNull()
    })

    it('should return null for null response', () => {
      const result = adaptToolOutput('test_tool', null)

      expect(result).toBeNull()
    })

    it('should return null for undefined response', () => {
      const result = adaptToolOutput('test_tool', undefined)

      expect(result).toBeNull()
    })

    it('should pass toolArgs to adapter', () => {
      registerOutputAdapter('args_tool', (response, toolArgs) => {
        return { model: toolArgs.model, id: response.id }
      })

      const result = adaptToolOutput('args_tool', { id: '123' }, { model: 'deal' })

      expect(result).toEqual({ model: 'deal', id: '123' })
    })

    it('should catch adapter errors and return null', () => {
      registerOutputAdapter('error_tool', () => {
        throw new Error('adapter failure')
      })

      const result = adaptToolOutput('error_tool', { value: 'hello' })

      expect(result).toBeNull()
    })

    it('should default toolArgs to empty object', () => {
      registerOutputAdapter('default_args_tool', (response, toolArgs) => {
        return { hasArgs: Object.keys(toolArgs).length > 0 }
      })

      const result = adaptToolOutput('default_args_tool', { value: 'test' })

      expect(result).toEqual({ hasArgs: false })
    })
  })
})
