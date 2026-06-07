import {
  buildAssociationInstructions,
  isAssociationResolved,
  resolveFormAssociations
} from '../../../../src/mcp/apps/lib/app-form-associations.js'
import { flatConvention } from '../../../__fixtures__/flat-convention.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MockModel = {
  api: { convention: flatConvention },
  associations: {
    belongsTo: {
      linear_channel: { rel: 'linear_channel', target_model: 'linear_channel', required: true },
      title: { rel: 'title', target_model: 'title', required: true },
      asset: { rel: 'asset', target_model: 'asset' }
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('lib/mcp/apps/form-associations', () => {
  describe('resolveFormAssociations', () => {
    it('returns all resolved when all required associations prefilled via _id', () => {
      const prefill = { linear_channel_id: 25, title_id: 123 }
      const result = resolveFormAssociations(
        ['linear_channel', 'title', 'asset'],
        MockModel,
        prefill
      )

      expect(result.hasUnresolvedRequired).toBe(false)
      expect(result.resolved).toHaveLength(2)
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0].association).toBe('asset')
      expect(result.unresolved[0].required).toBe(false)
    })

    it('returns all resolved when associations prefilled via _link', () => {
      const prefill = {
        linear_channel_link: 'https://api/linear_channels/25',
        title_link: 'https://api/titles/123'
      }
      const result = resolveFormAssociations(['linear_channel', 'title'], MockModel, prefill)

      expect(result.hasUnresolvedRequired).toBe(false)
      expect(result.resolved).toHaveLength(2)
    })

    it('returns hasUnresolvedRequired when a required association is missing', () => {
      const prefill = { linear_channel_id: 25 } // title missing
      const result = resolveFormAssociations(
        ['linear_channel', 'title', 'asset'],
        MockModel,
        prefill
      )

      expect(result.hasUnresolvedRequired).toBe(true)
      expect(result.resolved).toHaveLength(1)
      expect(result.unresolved).toHaveLength(2)
    })

    it('does not block when only optional associations are missing', () => {
      const prefill = { linear_channel_id: 25, title_id: 123 }
      const result = resolveFormAssociations(
        ['linear_channel', 'title', 'asset'],
        MockModel,
        prefill
      )

      expect(result.hasUnresolvedRequired).toBe(false)
    })

    it('includes optional resolved associations in resolved list', () => {
      const prefill = { linear_channel_id: 25, title_id: 123, asset_id: 456 }
      const result = resolveFormAssociations(
        ['linear_channel', 'title', 'asset'],
        MockModel,
        prefill
      )

      expect(result.resolved).toHaveLength(3)
      expect(result.unresolved).toHaveLength(0)
    })

    it('skips association names not found in model', () => {
      const prefill = { linear_channel_id: 25, title_id: 123 }
      const result = resolveFormAssociations(
        ['linear_channel', 'title', 'nonexistent'],
        MockModel,
        prefill
      )

      expect(result.resolved).toHaveLength(2)
      expect(result.unresolved).toHaveLength(0)
    })

    it('returns empty when no associations declared', () => {
      const result = resolveFormAssociations([], MockModel, {})

      expect(result.resolved).toHaveLength(0)
      expect(result.unresolved).toHaveLength(0)
      expect(result.hasUnresolvedRequired).toBe(false)
    })
  })

  describe('isAssociationResolved', () => {
    it('detects _link field in prefill (HAL)', () => {
      expect(isAssociationResolved('title', flatConvention, { title_link: 'https://...' })).toBe(
        true
      )
    })

    it('detects _id field in prefill (HAL)', () => {
      expect(isAssociationResolved('title', flatConvention, { title_id: 123 })).toBe(true)
    })

    it('returns false when neither _link nor _id present', () => {
      expect(isAssociationResolved('title', flatConvention, { other_field: 'x' })).toBe(false)
    })

    it('falls back to pattern matching without convention', () => {
      expect(isAssociationResolved('title', null, { title_link: 'url' })).toBe(true)
      expect(isAssociationResolved('title', null, { title_id: 123 })).toBe(true)
      expect(isAssociationResolved('title', null, {})).toBe(false)
    })
  })

  describe('buildAssociationInstructions', () => {
    it('generates instructions from unresolved list', () => {
      const unresolved = [
        { association: 'linear_channel', required: true, targetModel: 'linear_channel' },
        { association: 'asset', required: false, targetModel: 'asset' }
      ]
      const instructions = buildAssociationInstructions(unresolved)

      expect(instructions).toHaveLength(2)
      expect(instructions[0]).toEqual({
        association: 'linear_channel',
        targetModel: 'linear_channel',
        required: true,
        message: 'Select a linear channel'
      })
      expect(instructions[1]).toEqual({
        association: 'asset',
        targetModel: 'asset',
        required: false,
        message: 'Optionally select a asset'
      })
    })

    it('includes dependsOn in instructions', () => {
      const unresolved = [
        { association: 'asset', required: false, targetModel: 'asset', dependsOn: 'title' }
      ]
      const instructions = buildAssociationInstructions(unresolved)

      expect(instructions[0]).toEqual({
        association: 'asset',
        targetModel: 'asset',
        required: false,
        dependsOn: 'title',
        message: 'Optionally select a asset (scoped to the selected title)'
      })
    })
  })

  describe('dependsOn support', () => {
    it('handles mixed string and object entries', () => {
      const associations = ['linear_channel', 'title', { name: 'asset', dependsOn: 'title' }]
      const prefill = { linear_channel_id: 25, title_id: 123 }
      const result = resolveFormAssociations(associations, MockModel, prefill)

      expect(result.resolved).toHaveLength(2)
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0].association).toBe('asset')
      expect(result.unresolved[0].dependsOn).toBe('title')
    })

    it('resolves dependent association when prefilled', () => {
      const associations = ['title', { name: 'asset', dependsOn: 'title' }]
      const prefill = { title_id: 123, asset_id: 456 }
      const result = resolveFormAssociations(associations, MockModel, prefill)

      expect(result.resolved).toHaveLength(2)
      expect(result.resolved[1].dependsOn).toBe('title')
    })
  })

  describe('picker support', () => {
    it('propagates picker in unresolved entries', () => {
      const associations = [{ name: 'title', picker: 'autocomplete' }]
      const result = resolveFormAssociations(associations, MockModel, {})

      expect(result.unresolved[0].picker).toBe('autocomplete')
    })

    it('propagates picker in resolved entries', () => {
      const associations = [{ name: 'title', picker: 'autocomplete' }]
      const result = resolveFormAssociations(associations, MockModel, { title_id: 123 })

      expect(result.resolved[0].picker).toBe('autocomplete')
    })

    it('includes picker in instructions', () => {
      const unresolved = [
        { association: 'title', required: true, targetModel: 'title', picker: 'autocomplete' }
      ]
      const instructions = buildAssociationInstructions(unresolved)

      expect(instructions[0].picker).toBe('autocomplete')
    })

    it('omits picker from entries when not specified', () => {
      const associations = ['title']
      const result = resolveFormAssociations(associations, MockModel, {})

      expect(result.unresolved[0]).not.toHaveProperty('picker')
    })
  })

  describe('navigation associations (not in belongsTo)', () => {
    const RenditionModel = {
      api: { convention: flatConvention },
      associations: {
        belongsTo: {
          asset: { rel: 'asset', target_model: 'asset' }
        }
      }
    }

    it('resolves navigation associations with inline targetModel', () => {
      const associations = [
        { name: 'title', targetModel: 'title', required: true, picker: 'autocomplete' },
        { name: 'asset', dependsOn: 'title', picker: 'list' }
      ]
      const result = resolveFormAssociations(associations, RenditionModel, {
        title_id: 1,
        asset_id: 2
      })

      expect(result.resolved).toHaveLength(2)
      expect(result.resolved[0].targetModel).toBe('title')
      expect(result.resolved[0].required).toBe(true)
      expect(result.resolved[1].targetModel).toBe('asset')
      expect(result.resolved[1].dependsOn).toBe('title')
    })

    it('marks navigation associations as unresolved when not prefilled', () => {
      const associations = [
        { name: 'title', targetModel: 'title', required: true, picker: 'autocomplete' },
        { name: 'asset', dependsOn: 'title', picker: 'list' }
      ]
      const result = resolveFormAssociations(associations, RenditionModel, {})

      expect(result.hasUnresolvedRequired).toBe(true)
      expect(result.unresolved).toHaveLength(2)
      expect(result.unresolved[0].association).toBe('title')
      expect(result.unresolved[1].association).toBe('asset')
    })

    it('uses inline required over model config', () => {
      const associations = [{ name: 'title', targetModel: 'title', required: true }]
      const result = resolveFormAssociations(associations, RenditionModel, {})

      // title is NOT in RenditionModel.belongsTo, required comes from inline config
      expect(result.unresolved[0].required).toBe(true)
    })
  })
})
