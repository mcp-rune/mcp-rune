/**
 * PromptContentGenerator - Fluent pipeline for assembling prompt documentation
 *
 * Thin orchestrator that delegates all rendering to composable generators
 * in the generators/ directory. Each generator is a pure function that takes
 * a context object and returns markdown.
 *
 * Usage:
 * ```typescript
 * get promptContent() {
 *   return PromptContentGenerator.for(RulePrompt, 'rule')
 *     .add('# Rule Creation Guide\n...')
 *     .standard({ skip: ['content'] })
 *     .toolUsage({ parentResource: this.parentResource })
 *     .attributeReference()
 *     .build()
 * }
 * ```
 */

import type { PromptClassLike } from './base-prompt.js'
import { generateAttributeReference } from './generators/attribute-reference-generator.js'
import { generateFlowDiagram } from './generators/flow-diagram-generator.js'
import { generateGuidance } from './generators/guidance-generator.js'
import { generateAllSections, generateSection } from './generators/section-generator.js'
import { generateSummary } from './generators/summary-generator.js'
import { generateToolUsage } from './generators/tool-usage-generator.js'

interface GeneratorContext {
  promptClass: PromptClassLike
  modelName: string
  appsEnabled: boolean
}

interface GeneratorOptions {
  appsEnabled?: boolean
}

interface StandardOptions {
  beforeSections?: string[]
  skip?: string[]
  customSections?: Record<string, (sectionNum: number) => string>
}

interface AllSectionsOptions {
  skip?: string[]
  customSections?: Record<string, (sectionNum: number) => string>
}

export class PromptContentGenerator {
  promptClass: PromptClassLike
  modelName: string
  appsEnabled: boolean
  parts: string[]
  _context: GeneratorContext

  constructor(promptClass: PromptClassLike, modelName: string, options: GeneratorOptions = {}) {
    this.promptClass = promptClass
    this.modelName = modelName
    this.appsEnabled = options.appsEnabled === true
    this.parts = []
    this._context = { promptClass, modelName, appsEnabled: this.appsEnabled }
  }

  /** Factory method for fluent API */
  static for(
    promptClass: PromptClassLike,
    modelName: string,
    options: GeneratorOptions = {}
  ): PromptContentGenerator {
    return new PromptContentGenerator(promptClass, modelName, options)
  }

  // ===========================================================================
  // FLUENT PIPELINE METHODS
  // ===========================================================================

  /** Add custom markdown content. */
  add(content: string): PromptContentGenerator {
    if (content) this.parts.push(content)
    return this
  }

  /** Add flow diagram overview from sections/fieldGroups config. */
  flowDiagram(): PromptContentGenerator {
    const content = generateFlowDiagram(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add stateful guidance instructions (mode selection, turn-taking, validation). */
  guidance(): PromptContentGenerator {
    const content = generateGuidance(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add a single section's documentation. */
  section(
    groupName: string,
    sectionNumber: number,
    options: Record<string, unknown> = {}
  ): PromptContentGenerator {
    const content = generateSection(this._context, groupName, sectionNumber, options)
    if (content) this.parts.push(content)
    return this
  }

  /** Add all sections documentation, auto-generated from sections config. */
  allSections(options: AllSectionsOptions = {}): PromptContentGenerator {
    const content = generateAllSections(this._context, options)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Standard pipeline: flowDiagram -> guidance -> beforeSections -> allSections -> summary.
   */
  standard(options: StandardOptions = {}): PromptContentGenerator {
    const { beforeSections = [], skip = [], customSections = {} } = options
    this.flowDiagram()
    this.guidance()
    for (const section of beforeSections) this.add(section)
    this.allSections({ skip, customSections })
    this.summary()
    return this
  }

  /** Add standard summary template. */
  summary(): PromptContentGenerator {
    const content = generateSummary(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add attribute reference table. */
  attributeReference(): PromptContentGenerator {
    const content = generateAttributeReference(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /** Add auto-generated tool usage documentation from `static toolUsage` config. */
  toolUsage(instanceOverrides: Record<string, unknown> = {}): PromptContentGenerator {
    const content = generateToolUsage(this._context, instanceOverrides)
    if (content) this.parts.push(content)
    return this
  }

  /** Build the final prompt content by joining all parts. */
  build(separator = '\n\n---\n\n'): string {
    return this.parts.filter(Boolean).join(separator)
  }
}
