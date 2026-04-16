export const MOCK_MODELS = {
  title: {
    endpoint: 'titles',
    attributes: ['id', 'name', 'external_id', 'title_type', 'episode_number', 'tags'],
    required: ['name'],
    search: {
      autocompleteFields: ['external_id', 'external_id_type'],
      filters: {
        external_id: { type: 'text', label: 'External ID' },
        title_type: { type: 'enum', label: 'Title Type', enumValues: ['feature', 'episode'] },
        licensor_id: { type: 'relation', label: 'Licensor', relatedModel: 'licensor' }
      }
    },
    description: 'Titles (movies, episodes, features)',
    associations: {
      belongsTo: {
        licensor: { rel: 'licensor', target_model: 'licensor', expandable: true }
      },
      hasMany: {
        images: { rel: 'images', target_model: 'image', expandable: true },
        assets: { rel: 'assets', target_model: 'asset', expandable: true }
      },
      custom: {
        schedule: { rel: 'schedule', description: 'Schedule information' }
      }
    }
  },
  image: {
    endpoint: 'images',
    attributes: ['id', 'encoding', 'width', 'height', 'type', 'is_cover'],
    required: ['encoding'],
    search: {
      autocompleteFields: ['external_id'],
      filters: {
        type: { type: 'enum', label: 'Image Type', enumValues: ['poster', 'thumbnail'] }
      }
    },
    description: 'Images for titles and brands',
    associations: {
      belongsTo: {
        content: { rel: 'content', target_model: 'polymorphic', expandable: true }
      },
      hasMany: {}
    }
  },
  scheduling: {
    endpoint: 'schedulings',
    attributes: ['id', 'start_date', 'end_date'],
    required: [],
    description: 'Scheduling entries',
    api: {
      nested: {
        parentModels: ['title', 'title_group'],
        nestedOnly: true,
        notes: 'Must be created via title schedule endpoint'
      }
    }
  }
}
