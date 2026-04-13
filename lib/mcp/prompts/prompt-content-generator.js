/**
 * PromptContentGenerator - Fluent pipeline for assembling prompt documentation
 *
 * Thin orchestrator that delegates all rendering to composable generators
 * in the generators/ directory. Each generator is a pure function that takes
 * a context object and returns markdown.
 *
 * Usage:
 * ```javascript
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

import { generateSection, generateAllSections } from './generators/section-generator.js'
import { generateFlowDiagram } from './generators/flow-diagram-generator.js'
import { generateGuidance } from './generators/guidance-generator.js'
import { generateSummary } from './generators/summary-generator.js'
import { generateAttributeReference } from './generators/attribute-reference-generator.js'
import { generateToolUsage } from './generators/tool-usage-generator.js'

export class PromptContentGenerator {
  /**
   * @param {typeof import('./base-prompt.js').BasePrompt} promptClass
   * @param {string} modelName
   * @param {Object} [options]
   * @param {boolean} [options.appsEnabled=false] - Whether app tools are available
   */
  constructor(promptClass, modelName, options = {}) {
    this.promptClass = promptClass
    this.modelName = modelName
    this.appsEnabled = options.appsEnabled === true
    this.parts = []
    /** @type {{ promptClass: Object, modelName: string, appsEnabled: boolean }} */
    this._context = { promptClass, modelName, appsEnabled: this.appsEnabled }
  }

  /**
   * Factory method for fluent API
   * @param {typeof import('./base-prompt.js').BasePrompt} promptClass
   * @param {string} modelName
   * @param {Object} [options]
   * @returns {PromptContentGenerator}
   */
  static for(promptClass, modelName, options = {}) {
    return new PromptContentGenerator(promptClass, modelName, options)
  }

  // ===========================================================================
  // FLUENT PIPELINE METHODS
  // ===========================================================================

  /**
   * Add custom markdown content.
   * @param {string} content
   * @returns {PromptContentGenerator}
   */
  add(content) {
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Add flow diagram overview from sections/fieldGroups config.
   * @returns {PromptContentGenerator}
   */
  flowDiagram() {
    const content = generateFlowDiagram(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Add stateful guidance instructions (mode selection, turn-taking, validation).
   * @returns {PromptContentGenerator}
   */
  guidance() {
    const content = generateGuidance(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Add a single section's documentation.
   * @param {string} groupName - Field group name
   * @param {number} sectionNumber - Section number (1-based)
   * @param {Object} [options]
   * @returns {PromptContentGenerator}
   */
  section(groupName, sectionNumber, options = {}) {
    const content = generateSection(this._context, groupName, sectionNumber, options)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Add all sections documentation, auto-generated from sections config.
   * @param {Object} [options]
   * @param {string[]} [options.skip] - Section names to skip
   * @param {Object.<string, Function>} [options.customSections] - Custom generators
   * @returns {PromptContentGenerator}
   */
  allSections(options = {}) {
    const content = generateAllSections(this._context, options)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Standard pipeline: flowDiagram → guidance → beforeSections → allSections → summary.
   * @param {Object} [options]
   * @param {string[]} [options.beforeSections] - Custom content before allSections
   * @param {string[]} [options.skip] - Section names to skip in allSections
   * @param {Object} [options.customSections] - Custom section generators
   * @returns {PromptContentGenerator}
   */
  standard(options = {}) {
    const { beforeSections = [], skip = [], customSections = {} } = options
    this.flowDiagram()
    this.guidance()
    for (const section of beforeSections) this.add(section)
    this.allSections({ skip, customSections })
    this.summary()
    return this
  }

  /**
   * Add standard summary template.
   * @returns {PromptContentGenerator}
   */
  summary() {
    const content = generateSummary(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Add attribute reference table.
   * @returns {PromptContentGenerator}
   */
  attributeReference() {
    const content = generateAttributeReference(this._context)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Add auto-generated tool usage documentation from `static toolUsage` config.
   * @param {Object} [instanceOverrides] - Instance-level overrides (e.g., { parentResource })
   * @returns {PromptContentGenerator}
   */
  toolUsage(instanceOverrides = {}) {
    const content = generateToolUsage(this._context, instanceOverrides)
    if (content) this.parts.push(content)
    return this
  }

  /**
   * Build the final prompt content by joining all parts.
   * @param {string} [separator='\n\n---\n\n'] - Separator between parts
   * @returns {string}
   */
  build(separator = '\n\n---\n\n') {
    return this.parts.filter(Boolean).join(separator)
  }
}
