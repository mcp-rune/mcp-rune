import { ANALYSIS_TOOL_CLASSES } from '../../../../src/mcp/tools/analysis/index.js'
import { DATA_TOOL_CLASSES } from '../../../../src/mcp/tools/data/index.js'
import { DOMAIN_TOOL_CLASSES } from '../../../../src/mcp/tools/domain/index.js'
import { OPERATIONS_TOOL_CLASSES } from '../../../../src/mcp/tools/operations/index.js'

const ALL_TOOL_CLASSES = {
  ...DATA_TOOL_CLASSES,
  ...ANALYSIS_TOOL_CLASSES,
  ...OPERATIONS_TOOL_CLASSES,
  ...DOMAIN_TOOL_CLASSES
}

const minimalDeps = {
  models: { book: { api: { endpoint: '/books' }, attributes: {}, search: { filters: {} } } }
}

describe('tool annotations enforcement', () => {
  for (const [name, ToolClass] of Object.entries(ALL_TOOL_CLASSES)) {
    describe(name, () => {
      it('should define annotations with readOnlyHint as a boolean', () => {
        const tool = new ToolClass(minimalDeps)
        const annotations = tool.annotations
        expect(annotations).toBeDefined()
        expect(typeof annotations.readOnlyHint).toBe('boolean')
      })

      it('should define destructiveHint as a boolean when tool is not read-only', () => {
        const tool = new ToolClass(minimalDeps)
        const { readOnlyHint, destructiveHint } = tool.annotations
        if (readOnlyHint === false) {
          expect(typeof destructiveHint).toBe('boolean')
        }
      })

      it('should define openWorldHint as a boolean', () => {
        const tool = new ToolClass(minimalDeps)
        expect(typeof tool.annotations.openWorldHint).toBe('boolean')
      })
    })
  }
})
