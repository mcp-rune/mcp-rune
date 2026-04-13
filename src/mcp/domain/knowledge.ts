/**
 * DomainKnowledge - Cross-entity domain knowledge
 *
 * Captures knowledge that spans models -- NOT field-level metadata
 * already in model attributes. Individual model attributes, enums,
 * descriptions, and examples are the source of truth for field-level
 * knowledge. This class adds cross-entity concepts on top.
 *
 * Concepts represent relationships, inheritance rules, decision
 * frameworks, and processes that span multiple models.
 */

import type { DomainSearchStrategy, DomainItem } from './search-strategy.js'
import { SubstringSearch, createDomainSearch } from './search-strategy.js'

export interface DomainConceptConfig {
  name: string
  title: string
  description: string
  models: string[]
  tags?: string[]
  details?: Record<string, unknown>
}

export class DomainConcept {
  name: string
  title: string
  description: string
  models: string[]
  tags: string[]
  details: Record<string, unknown>

  constructor({ name, title, description, models, tags = [], details = {} }: DomainConceptConfig) {
    this.name = name
    this.title = title
    this.description = description
    this.models = models
    this.tags = tags
    this.details = details
  }
}

export interface ModelClass {
  description?: string
  api?: { readOnly?: boolean }
  attributes?: Record<
    string,
    {
      label?: string
      type?: string
      required?: boolean
      immutable?: boolean
      description?: string
    }
  >
  associations?: Record<string, unknown>
}

export interface DomainKnowledgeConfig {
  concepts?: DomainConcept[]
  models?: Record<string, ModelClass>
}

export interface ModelContext {
  model: string
  concepts: Array<{
    name: string
    title: string
    description: string
    models: string[]
    details: Record<string, unknown>
  }>
  description?: string
  readOnly?: boolean
  attributes?: Array<{
    name: string
    label?: string
    type?: string
    required: boolean
    immutable: boolean
    description?: string
  }>
  associations?: Record<string, unknown>
  rules?: Array<{ name: string; description: string; severity: string }>
  workflows?: Array<{ name: string; title: string; description: string; tags: string[] }>
}

export class DomainKnowledge {
  concepts: Map<string, DomainConcept>
  models: Record<string, ModelClass>
  private _search: DomainSearchStrategy

  constructor({ concepts = [], models = {} }: DomainKnowledgeConfig = {}) {
    this.concepts = new Map(concepts.map((c) => [c.name, c]))
    this.models = models
    this._search = new SubstringSearch(this.getAllConcepts() as unknown as DomainItem[])
  }

  /** Initialize search over concepts */
  async initSearch(strategy?: string): Promise<void> {
    if (strategy) {
      this._search = createDomainSearch(strategy)
    }
    await this._search.initialize(
      this.getAllConcepts() as unknown as DomainItem[],
      (c) => `${c.name} ${c.title}: ${c.description} ${(c.tags ?? []).join(' ')}`
    )
  }

  /** Get a specific concept by name */
  getConcept(name: string): DomainConcept | undefined {
    return this.concepts.get(name)
  }

  /** Get all concepts */
  getAllConcepts(): DomainConcept[] {
    return Array.from(this.concepts.values())
  }

  /**
   * Search concepts by query string
   *
   * Uses semantic search (embedding similarity) when initialized,
   * falls back to substring matching otherwise.
   */
  async searchConcepts(query: string): Promise<DomainConcept[]> {
    return this._search.search(query) as unknown as Promise<DomainConcept[]>
  }

  /** Get all concepts that involve a specific model */
  getConceptsForModel(modelName: string): DomainConcept[] {
    return this.getAllConcepts().filter((c) => c.models.includes(modelName))
  }

  /** Get concepts by tag */
  getConceptsByTag(tag: string): DomainConcept[] {
    return this.getAllConcepts().filter((c) => c.tags.includes(tag))
  }

  /** Compose context for a model: field-level metadata from model class + cross-entity concepts */
  getContextForModel(modelName: string): ModelContext {
    const ModelClassDef = this.models[modelName]
    const concepts = this.getConceptsForModel(modelName)

    const context: ModelContext = {
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
    if (ModelClassDef) {
      context.description = ModelClassDef.description
      context.readOnly = ModelClassDef.api?.readOnly || false
      context.attributes = Object.entries(ModelClassDef.attributes || {}).map(([name, config]) => ({
        name,
        label: config.label,
        type: config.type,
        required: config.required || false,
        immutable: config.immutable || false,
        description: config.description
      }))
      context.associations = ModelClassDef.associations || {}
    }

    return context
  }
}
