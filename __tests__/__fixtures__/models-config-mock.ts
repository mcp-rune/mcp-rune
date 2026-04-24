export const MOCK_MODELS = {
  title: {
    attributes: ['id', 'name', 'external_id', 'title_type', 'episode_number', 'tags'],
    required: ['name'],
    search: {
      lookup: { fields: ['external_id', 'external_id_type'] },
      filters: {
        external_id: { type: 'text', label: 'External ID' },
        title_type: { type: 'enum', label: 'Title Type', enumValues: ['feature', 'episode'] },
        licensor_id: { type: 'relation', label: 'Licensor', relatedModel: 'licensor' }
      }
    },
    description: 'Titles (movies, episodes, features)',
    api: {
      endpoint: 'titles'
    },
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
    attributes: ['id', 'encoding', 'width', 'height', 'type', 'is_cover'],
    required: ['encoding'],
    search: {
      lookup: { fields: ['external_id'] },
      filters: {
        type: { type: 'enum', label: 'Image Type', enumValues: ['poster', 'thumbnail'] }
      }
    },
    description: 'Images for titles and brands',
    api: {
      endpoint: 'images'
    },
    associations: {
      belongsTo: {
        content: { rel: 'content', target_model: 'polymorphic', expandable: true }
      },
      hasMany: {}
    }
  },
  asset: {
    attributes: ['id', 'name', 'encoding'],
    required: ['name'],
    description: 'Assets (video files)',
    api: {
      endpoint: 'assets',
      parent: 'title',
      standalone: false
    },
    associations: {
      belongsTo: {
        title: { rel: 'title', target_model: 'title', expandable: true }
      }
    }
  },
  scheduling: {
    attributes: ['id', 'start_date', 'end_date'],
    required: [],
    description: 'Scheduling entries',
    api: {
      endpoint: 'schedulings',
      parent: ['title', 'title_group'],
      standalone: false
    }
  }
}
