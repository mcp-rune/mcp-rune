/**
 * DomainKnowledge - Cross-entity domain knowledge
 *
 * Captures knowledge that spans models — NOT field-level metadata
 * already in model attributes. Individual model attributes, enums,
 * descriptions, and examples are the source of truth for field-level
 * knowledge. This class adds cross-entity concepts on top.
 *
 * Concepts represent relationships, inheritance rules, decision
 * frameworks, and processes that span multiple models.
 */

import { SubstringSearch, createDomainSearch } from './search-strategy.js'

export class DomainConcept {
  /**
   * @param {Object} config
   * @param {string} config.name - Unique concept identifier (e.g., 'deal_rights_hierarchy')
   * @param {string} config.title - Human-readable title
   * @param {string} config.description - Explanation of the cross-entity concept
   * @param {string[]} config.models - Models this concept spans
   * @param {string[]} [config.tags] - Tags for search/filtering
   * @param {Object} [config.details] - Additional structured details (inheritance, process, tips)
   */
  constructor({ name, title, description, models, tags = [], details = {} }) {
    this.name = name
    this.title = title
    this.description = description
    this.models = models
    this.tags = tags
    this.details = details
  }
}

export class DomainKnowledge {
  constructor({ concepts = [], models = {} } = {}) {
    this.concepts = new Map(concepts.map((c) => [c.name, c]))
    this.models = models
    this._search = new SubstringSearch(this.getAllConcepts())
  }

  /**
   * Initialize search over concepts
   * @param {string} [strategy='substring'] - Search strategy ('substring' | 'embedding')
   * @returns {Promise<void>}
   */
  async initSearch(strategy) {
    if (strategy) {
      this._search = createDomainSearch(strategy)
    }
    await this._search.initialize(
      this.getAllConcepts(),
      (c) => `${c.name} ${c.title}: ${c.description} ${c.tags.join(' ')}`
    )
  }

  /**
   * Get a specific concept by name
   * @param {string} name - Concept name
   * @returns {DomainConcept|undefined}
   */
  getConcept(name) {
    return this.concepts.get(name)
  }

  /**
   * Get all concepts
   * @returns {DomainConcept[]}
   */
  getAllConcepts() {
    return Array.from(this.concepts.values())
  }

  /**
   * Search concepts by query string
   *
   * Uses semantic search (embedding similarity) when initialized,
   * falls back to substring matching otherwise.
   *
   * @param {string} query - Search query
   * @returns {Promise<DomainConcept[]>}
   */
  async searchConcepts(query) {
    return this._search.search(query)
  }

  /**
   * Get all concepts that involve a specific model
   * @param {string} modelName - Model name
   * @returns {DomainConcept[]}
   */
  getConceptsForModel(modelName) {
    return this.getAllConcepts().filter((c) => c.models.includes(modelName))
  }

  /**
   * Get concepts by tag
   * @param {string} tag - Tag to filter by
   * @returns {DomainConcept[]}
   */
  getConceptsByTag(tag) {
    return this.getAllConcepts().filter((c) => c.tags.includes(tag))
  }

  /**
   * Compose context for a model: field-level metadata from model class + cross-entity concepts
   * @param {string} modelName - Model name
   * @returns {Object} Composed context
   */
  getContextForModel(modelName) {
    const ModelClass = this.models[modelName]
    const concepts = this.getConceptsForModel(modelName)

    const context = {
      model: modelName,
      concepts: concepts.map((c) => ({
        name: c.name,
        title: c.title,
        description: c.description,
        models: c.models,
        details: c.details
      }))
    }

    // Pull field-level metadata from model class if available
    if (ModelClass) {
      context.description = ModelClass.description
      context.readOnly = ModelClass.api?.readOnly || false
      context.attributes = Object.entries(ModelClass.attributes || {}).map(([name, config]) => ({
        name,
        label: config.label,
        type: config.type,
        required: config.required || false,
        immutable: config.immutable || false,
        description: config.description
      }))
      context.associations = ModelClass.associations || {}
    }

    return context
  }
}
